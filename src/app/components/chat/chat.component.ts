import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { AiService } from '../../services/core/ai/ai.service';
import { finalize } from 'rxjs';

interface Message {
  text: string;
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
            { text: response.data, sender: 'ai', timestamp: new Date() },
          ]);
        },
        error: (err) => {
          console.error('Error sending message:', err);
          this.messages.update((msgs) => [
            ...msgs,
            { text: 'Sorry, something went wrong. Please try again.', sender: 'ai', timestamp: new Date() },
          ]);
        },
      });
  }
}
