import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UiFeedbackHostComponent } from './core/ui-feedback/ui-feedback-host';
import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, UiFeedbackHostComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  // Fija el tema claro (identidad EscalApp); el modo oscuro fue retirado.
  private readonly theme = inject(ThemeService);
  protected readonly title = signal('negocio-app');
}
