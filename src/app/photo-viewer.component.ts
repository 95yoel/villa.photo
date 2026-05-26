import { CommonModule, DOCUMENT } from '@angular/common';
import {
  Component,
  DestroyRef,
  HostListener,
  Inject,
  input,
  output
} from '@angular/core';
import { decode } from 'blurhash';
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
  readonly previous = output<void>();
  readonly next = output<void>();

  protected loadedPhotoId: string | null = null;
  protected shareState: 'idle' | 'copied' | 'failed' = 'idle';

  private touchStartX: number | null = null;
  private touchStartY: number | null = null;
  private readonly blurhashCache = new Map<string, string>();
  private shareStateTimeout: number | null = null;

  private readonly minSwipeDistance = 48;
  private readonly maxVerticalSwipeDrift = 80;

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

  @HostListener('document:keydown.arrowleft', ['$event'])
  protected onArrowLeft(event: KeyboardEvent): void {
    event.preventDefault();
    this.previous.emit();
  }

  @HostListener('document:keydown.arrowright', ['$event'])
  protected onArrowRight(event: KeyboardEvent): void {
    event.preventDefault();
    this.next.emit();
  }

  protected onBackdropClick(): void {
    this.close.emit();
  }

  protected onCloseClick(): void {
    this.close.emit();
  }

  protected onPreviousClick(): void {
    this.previous.emit();
  }

  protected onNextClick(): void {
    this.next.emit();
  }

  protected async onShareClick(): Promise<void> {
    const photo = this.photo();
    const shareUrl = this.document.defaultView?.location.href ?? '';
    const shareData: ShareData = {
      title: photo.title,
      text: `${photo.title} - ${photo.location}`,
      url: shareUrl
    };

    this.shareState = 'idle';

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }

      await navigator.clipboard.writeText(shareUrl);
      this.setTemporaryShareState('copied');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      this.setTemporaryShareState('failed');
    }
  }

  protected getPhotoPlaceholder(photo: Photo): string {
    const cachedPlaceholder = this.blurhashCache.get(photo.id);

    if (cachedPlaceholder) {
      return cachedPlaceholder;
    }

    try {
      const width = 48;
      const height = Math.max(1, Math.round(width * (photo.height / photo.width)));
      const pixels = decode(photo.blurhash, width, height);
      const canvas = this.document.createElement('canvas');
      const context = canvas.getContext('2d');

      canvas.width = width;
      canvas.height = height;

      if (!context) {
        return '';
      }

      const imageData = context.createImageData(width, height);
      imageData.data.set(pixels);
      context.putImageData(imageData, 0, 0);

      const placeholder = `url("${canvas.toDataURL('image/png')}")`;
      this.blurhashCache.set(photo.id, placeholder);

      return placeholder;
    } catch {
      return '';
    }
  }

  protected onImageLoad(photo: Photo): void {
    this.loadedPhotoId = photo.id;
  }

  protected isPhotoLoaded(photo: Photo): boolean {
    return this.loadedPhotoId === photo.id;
  }

  protected onTouchStart(event: TouchEvent): void {
    const [touch] = Array.from(event.changedTouches);

    this.touchStartX = touch?.clientX ?? null;
    this.touchStartY = touch?.clientY ?? null;
  }

  protected onTouchEnd(event: TouchEvent): void {
    if (this.touchStartX === null || this.touchStartY === null) {
      return;
    }

    const [touch] = Array.from(event.changedTouches);
    const endX = touch?.clientX;
    const endY = touch?.clientY;

    if (endX === undefined || endY === undefined) {
      this.resetTouchStart();
      return;
    }

    const deltaX = endX - this.touchStartX;
    const deltaY = endY - this.touchStartY;

    this.resetTouchStart();

    if (
      Math.abs(deltaX) < this.minSwipeDistance ||
      Math.abs(deltaY) > this.maxVerticalSwipeDrift ||
      Math.abs(deltaX) < Math.abs(deltaY)
    ) {
      return;
    }

    if (deltaX < 0) {
      this.next.emit();
      return;
    }

    this.previous.emit();
  }

  private resetTouchStart(): void {
    this.touchStartX = null;
    this.touchStartY = null;
  }

  private setTemporaryShareState(state: 'copied' | 'failed'): void {
    this.shareState = state;

    if (this.shareStateTimeout !== null) {
      window.clearTimeout(this.shareStateTimeout);
    }

    this.shareStateTimeout = window.setTimeout(() => {
      this.shareState = 'idle';
      this.shareStateTimeout = null;
    }, 1600);
  }
}
