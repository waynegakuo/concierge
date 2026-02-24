import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  AiService,
  ConciergeResponse,
  InterruptData,
} from '../../services/core/ai/ai.service';
import { finalize } from 'rxjs';
import { MarkdownUtils } from '../../utils/markdown-utils';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

interface Message {
  text: string;
  formattedText?: SafeHtml;
  sender: 'user' | 'ai';
  timestamp: Date;
  isInterrupt?: boolean;
}

interface WelcomeCapability {
  icon: string;
  title: string;
  description: string;
}

interface InterruptState {
  interrupt: InterruptData;
  messages: unknown[];
  originalQuery: string;
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatComponent implements AfterViewChecked {
  private readonly aiService = inject(AiService);
  private sanitizer = inject(DomSanitizer);

  @ViewChild('messageList') private messageList?: ElementRef<HTMLElement>;
  private shouldScrollToBottom = false;

  messages = signal<Message[]>([]);
  isLoading = signal(false);
  pendingInterrupt = signal<InterruptState | null>(null);
  queryControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });

  // Welcome message content
  readonly welcomeTitle = "Welcome! I'm your Concierge AI Assistant";
  readonly welcomeDescription =
    "I can help you with a variety of things to make your planning easier! Here's a quick rundown of what I can do:";
  readonly welcomeFooter = 'Just let me know what you need help with!';
  readonly welcomeCapabilities: WelcomeCapability[] = [
    {
      icon: '🗺️',
      title: 'Plan Day Trips:',
      description: 'I can assist you in planning exciting day trips.',
    },
    {
      icon: '🍽️',
      title: 'Find Restaurants:',
      description:
        'Looking for the best places to eat? I can help you find restaurants based on your preferences.',
    },
    {
      icon: '🎉',
      title: 'Discover Weekend Activities:',
      description:
        "If you're wondering what to do on a specific weekend, I can help you find interesting events, concerts, festivals, and other activities.",
    },
    {
      icon: '🚗',
      title: 'Navigate and Find Routes:',
      description:
        'I can assist you with finding the best routes and transportation options to get you where you need to go.',
    },
  ];

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  sendMessage(): void {
    const query = this.queryControl.value.trim();
    if (!query || this.isLoading()) return;

    // Add user message
    this.messages.update((msgs) => [
      ...msgs,
      { text: query, sender: 'user', timestamp: new Date() },
    ]);

    this.queryControl.reset();
    this.isLoading.set(true);
    this.shouldScrollToBottom = true;

    const interrupt = this.pendingInterrupt();

    if (interrupt) {
      // Resuming from an interrupt — send the user's response back
      this.pendingInterrupt.set(null);
      this.aiService
        .sendMessage(interrupt.originalQuery, interrupt.messages, {
          toolName: interrupt.interrupt.toolName,
          response: query,
        })
        .pipe(finalize(() => this.finalizeRequest()))
        .subscribe({
          next: (response) => this.handleResponse(response.data, interrupt.originalQuery),
          error: (err) => this.handleError(err),
        });
    } else {
      // Standard message
      this.aiService
        .sendMessage(query)
        .pipe(finalize(() => this.finalizeRequest()))
        .subscribe({
          next: (response) => this.handleResponse(response.data, query),
          error: (err) => this.handleError(err),
        });
    }
  }

  private handleResponse(response: ConciergeResponse, originalQuery: string): void {
    if (response.interrupt) {
      // Store interrupt state for the next user message
      this.pendingInterrupt.set({
        interrupt: response.interrupt,
        messages: response.messages ?? [],
        originalQuery,
      });

      const interruptText =
        'I need a bit more information to help you. Could you please provide additional details?';
      this.messages.update((msgs) => [
        ...msgs,
        {
          text: interruptText,
          formattedText: this.formatMarkdown(interruptText),
          sender: 'ai',
          timestamp: new Date(),
          isInterrupt: true,
        },
      ]);
    } else if (response.text) {
      this.messages.update((msgs) => [
        ...msgs,
        {
          text: response.text!,
          formattedText: this.formatMarkdown(response.text!),
          sender: 'ai',
          timestamp: new Date(),
        },
      ]);
    }
    this.shouldScrollToBottom = true;
  }

  private handleError(err: unknown): void {
    console.error('Error sending message:', err);
    this.pendingInterrupt.set(null);
    const errorText = 'Sorry, something went wrong. Please try again.';
    this.messages.update((msgs) => [
      ...msgs,
      {
        text: errorText,
        formattedText: this.formatMarkdown(errorText),
        sender: 'ai',
        timestamp: new Date(),
      },
    ]);
    this.shouldScrollToBottom = true;
  }

  private finalizeRequest(): void {
    this.isLoading.set(false);
    this.shouldScrollToBottom = true;
  }

  private scrollToBottom(): void {
    if (this.messageList?.nativeElement) {
      this.messageList.nativeElement.scrollTo({
        top: this.messageList.nativeElement.scrollHeight,
        behavior: 'smooth',
      });
    }
  }

  private formatMarkdown(text: string): SafeHtml {
    const html = MarkdownUtils.formatMarkdown(text);
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
