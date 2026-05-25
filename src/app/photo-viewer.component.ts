import { CommonModule, DOCUMENT } from '@angular/common';
import {
  Component,
  DestroyRef,
  HostListener,
  Inject,
  input,
  output
} from '@angular/core';
import { Photo } from './models/photo.model';

@Component({
  selector: 'app-photo-viewer',
  imports: [CommonModule],
  templateUrl: './photo-viewer.component.html',
  styleUrl: './photo-viewer.component.css'
})
export class PhotoViewerComponent {
  readonly photo = input.required<Photo>();
  readonly close = output<void>();

  constructor(
    @Inject(DOCUMENT) private readonly document: Document,
    destroyRef: DestroyRef
  ) {
    const previousOverflow = this.document.body.style.overflow;

    this.document.body.style.overflow = 'hidden';

    destroyRef.onDestroy(() => {
      this.document.body.style.overflow = previousOverflow;
    });
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.close.emit();
  }

  protected onBackdropClick(): void {
    this.close.emit();
  }

  protected onCloseClick(): void {
    this.close.emit();
  }
}
