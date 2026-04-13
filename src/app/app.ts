import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UiFeedbackHostComponent } from './core/ui-feedback/ui-feedback-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, UiFeedbackHostComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('negocio-app');
}
