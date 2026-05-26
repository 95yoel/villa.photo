import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-not-found-page',
  imports: [CommonModule],
  templateUrl: './not-found-page.component.html',
  styleUrl: './not-found-page.component.css'
})
export class NotFoundPageComponent {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private intervalId: number | null = null;
  private timeoutId: number | null = null;

  protected secondsRemaining = 3;

  constructor() {
    this.intervalId = window.setInterval(() => {
      this.secondsRemaining = Math.max(0, this.secondsRemaining - 1);
    }, 1000);

    this.timeoutId = window.setTimeout(() => {
      this.router.navigate(['/']);
    }, 3000);

    this.destroyRef.onDestroy(() => {
      if (this.intervalId !== null) {
        window.clearInterval(this.intervalId);
      }

      if (this.timeoutId !== null) {
        window.clearTimeout(this.timeoutId);
      }
    });
  }

  protected goHome(): void {
    this.router.navigate(['/']);
  }
}
