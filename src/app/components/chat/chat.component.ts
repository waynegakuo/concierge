import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { AiService } from '../../services/core/ai/ai.service';
import { finalize } from 'rxjs';
import {MarkdownUtils} from '../../utils/markdown-utils';
import {DomSanitizer, SafeHtml} from '@angular/platform-browser';

interface Message {
  text: string;
  formattedText?: SafeHtml;
  sender: 'user' | 'ai';
  timestamp: Date;
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatComponent {
  private readonly aiService = inject(AiService);
  private sanitizer = inject(DomSanitizer);

  messages = signal<Message[]>([]);
  isLoading = signal(false);
  queryControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });

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

    this.aiService
      .sendMessage(query)
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (response) => {
          this.messages.update((msgs) => [
            ...msgs,
            { text: response.data, formattedText: this.formatMarkdown(response.data), sender: 'ai', timestamp: new Date() },
          ]);
        },
        error: (err) => {
          console.error('Error sending message:', err);
          const errorText= 'Sorry, something went wrong. Please try again.'
          this.messages.update((msgs) => [
            ...msgs,
            { text: errorText, formattedText: this.formatMarkdown(errorText), sender: 'ai', timestamp: new Date() },
          ]);
        },
      });
  }

  private formatMarkdown(text: string): SafeHtml {
    const html = MarkdownUtils.formatMarkdown(text);
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
