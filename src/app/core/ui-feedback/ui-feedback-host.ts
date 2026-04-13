import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgClass } from '@angular/common';

import { UiFeedbackService, UiFeedbackTone } from './ui-feedback.service';

@Component({
  selector: 'app-ui-feedback-host',
  imports: [NgClass],
  templateUrl: './ui-feedback-host.html',
  styleUrl: './ui-feedback-host.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiFeedbackHostComponent {
  protected readonly uiFeedback = inject(UiFeedbackService);

  protected readonly toasts = this.uiFeedback.toasts;
  protected readonly dialog = this.uiFeedback.dialog;

  protected dismissToast(id: number): void {
    this.uiFeedback.dismissToast(id);
  }

  protected acceptDialog(): void {
    this.uiFeedback.acceptDialog();
  }

  protected cancelDialog(): void {
    this.uiFeedback.cancelDialog();
  }

  protected dismissDialogBackdrop(): void {
    this.uiFeedback.dismissDialog();
  }

  protected toneClass(tone: UiFeedbackTone): string {
    return `tone-${tone}`;
  }
}
