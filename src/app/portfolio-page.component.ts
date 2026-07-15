import { CommonModule, DOCUMENT, Location } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Inject,
  QueryList,
  ViewChildren,
  inject
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { decode } from 'blurhash';
import { AnalyticsService } from './analytics.service';
import { Photo, PhotoCategory } from './models/photo.model';
import { PhotoViewerComponent } from './photo-viewer.component';

const PHOTOS_MANIFEST_SCRIPT_URL = 'https://d1fmx8ncgs4siw.cloudfront.net/photos.js';
const PHOTOS_MANIFEST_GLOBAL_KEY = '__VILLA_PHOTOS__';

type GalleryKey = 'home' | PhotoCategory;
const GALLERY_KEYS: GalleryKey[] = ['home', 'costa', 'montana', 'nocturnas', 'ciudad'];

interface NavItem {
  id: 'home' | GalleryKey | 'contacto';
  label: string;
}

type PhotosManifestWindow = Window &
  typeof globalThis & {
    [PHOTOS_MANIFEST_GLOBAL_KEY]?: Photo[];
  };

@Component({
  selector: 'app-portfolio-page',
  imports: [CommonModule, PhotoViewerComponent],
  templateUrl: './portfolio-page.component.html',
  styleUrl: './portfolio-page.component.css'
})
export class PortfolioPageComponent implements AfterViewInit {
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly analytics = inject(AnalyticsService);

  protected readonly navItems: NavItem[] = [
    { id: 'home', label: 'Home' },
    { id: 'costa', label: 'Costa' },
    { id: 'montana', label: 'Montaña' },
    { id: 'nocturnas', label: 'Nocturnas' },
    { id: 'ciudad', label: 'Ciudad' },
    { id: 'contacto', label: 'Contacto' }
  ];

  protected readonly viewTitles: Record<GalleryKey, string> = {
    home: 'Home',
    costa: 'Costa',
    montana: 'Montaña',
    nocturnas: 'Nocturnas',
    ciudad: 'Ciudad'
  };

  protected readonly batchSize = 8;
  protected readonly initialVisibleCount = 10;
  protected readonly maxAutoLoads = 2;
  protected readonly highPriorityPhotoCount = 4;
  protected readonly fullResolutionPreloadConcurrency = 2;

  protected activeView: GalleryKey = 'home';
  protected photos: Photo[] = [];
  protected visibleCount = this.initialVisibleCount;
  protected selectedPhoto: Photo | null = null;
  protected isLoading = true;
  protected loadError = false;
  protected autoLoadsUsed = 0;
  protected copiedField: 'email' | 'instagram' | null = null;

  private isNavigatingToContact = false;
  private readonly blurhashCache = new Map<string, string>();
  private readonly loadedPhotoIds = new Set<string>();
  private readonly loadablePhotoIds = new Set<string>();
  private readonly observedPhotoIds = new Set<string>();
  private readonly fullResolutionPhotoIds = new Set<string>();
  private readonly queuedFullResolutionPhotoIds = new Set<string>();
  private readonly fullResolutionPreloadQueue: Photo[] = [];
  private readonly loadedFullResolutionImageUrls = new Set<string>();
  private readonly preloadedImageUrls = new Set<string>();
  private activeFullResolutionPreloads = 0;
  private intersectionObserver: IntersectionObserver | null = null;

  @ViewChildren('photoCardFigure', { read: ElementRef })
  private readonly photoCardFigures?: QueryList<ElementRef<HTMLElement>>;

  constructor(@Inject(DOCUMENT) private readonly document: Document) {}

  async ngAfterViewInit(): Promise<void> {
    await this.loadPhotos();
    this.syncStateFromRoute();
    this.queueInitialPhotos();
    this.createIntersectionObserver();
    this.observeRenderedPhotos();
    this.photoCardFigures?.changes.subscribe(() => this.observeRenderedPhotos());
    this.preloadUpcomingGalleryPhotos();
    window.setTimeout(() => this.observeRenderedPhotos());

    if (this.selectedPhoto) {
      this.preloadAdjacentViewerPhotos(this.selectedPhoto);
    }
  }

  protected get filteredPhotos(): Photo[] {
    if (this.activeView === 'home') {
      return this.photos;
    }

    return this.photos.filter((photo) => photo.category === this.activeView);
  }

  protected get visiblePhotos(): Photo[] {
    return this.filteredPhotos.slice(0, this.visibleCount);
  }

  protected get hasMorePhotos(): boolean {
    return this.visibleCount < this.filteredPhotos.length;
  }

  protected get hasPreviousSelectedPhoto(): boolean {
    return this.getSelectedPhotoIndex() > 0;
  }

  protected get hasNextSelectedPhoto(): boolean {
    const selectedPhotoIndex = this.getSelectedPhotoIndex();

    return (
      selectedPhotoIndex >= 0 &&
      selectedPhotoIndex < this.filteredPhotos.length - 1
    );
  }

  protected get selectedPhotoPosition(): number {
    const selectedPhotoIndex = this.getSelectedPhotoIndex();

    return selectedPhotoIndex < 0 ? 0 : selectedPhotoIndex + 1;
  }

  protected get selectedPhotoTotal(): number {
    return this.filteredPhotos.length;
  }

  protected selectView(view: GalleryKey): void {
    this.activeView = view;
    this.visibleCount = this.initialVisibleCount;
    this.autoLoadsUsed = 0;
    this.queueInitialPhotos();
    window.setTimeout(() => {
      this.observeRenderedPhotos();
      this.preloadUpcomingGalleryPhotos();
    });
    this.analytics.trackEvent('gallery_view_select', { view });
    this.syncRouteView();
  }

  protected scrollToHome(): void {
    this.activeView = 'home';
    this.visibleCount = this.initialVisibleCount;
    this.autoLoadsUsed = 0;
    this.queueInitialPhotos();
    window.setTimeout(() => {
      this.observeRenderedPhotos();
      this.preloadUpcomingGalleryPhotos();
    });
    this.analytics.trackEvent('gallery_view_select', { view: 'home' });
    this.syncRouteView();
    this.document.defaultView?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected scrollToContact(): void {
    this.isNavigatingToContact = true;
    this.analytics.trackEvent('contact_section_open', { source: 'navigation' });
    this.document.getElementById('contacto')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });

    window.setTimeout(() => {
      this.isNavigatingToContact = false;
    }, 1200);
  }

  protected handleNavClick(item: NavItem): void {
    if (item.id === 'home') {
      this.scrollToHome();
      return;
    }

    if (item.id === 'contacto') {
      this.scrollToContact();
      return;
    }

    this.selectView(item.id);
  }

  protected loadMorePhotos(): void {
    if (!this.hasMorePhotos) {
      return;
    }

    this.visibleCount = Math.min(
      this.visibleCount + this.batchSize,
      this.filteredPhotos.length
    );
    window.setTimeout(() => {
      this.observeRenderedPhotos();
      this.preloadUpcomingGalleryPhotos();
    });
  }

  protected openPhoto(photo: Photo): void {
    this.selectedPhoto = photo;
    this.preloadAdjacentViewerPhotos(photo);
    this.analytics.trackEvent('photo_open', {
      photo_slug: photo.slug,
      photo_title: photo.title,
      category: photo.category,
      location: photo.location,
      gallery_view: this.activeView
    });
    this.location.go(this.createPhotoUrl(photo.slug));
  }

  protected closePhoto(): void {
    this.selectedPhoto = null;
    this.analytics.trackEvent('photo_close', {
      gallery_view: this.activeView
    });
    this.location.go(this.createGalleryUrl(this.activeView));
  }

  protected showPreviousPhoto(): void {
    this.showAdjacentPhoto(-1);
  }

  protected showNextPhoto(): void {
    this.showAdjacentPhoto(1);
  }

  protected async copyText(
    value: string,
    field: 'email' | 'instagram'
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copiedField = field;
      this.analytics.trackEvent('contact_copy', {
        field
      });

      window.setTimeout(() => {
        if (this.copiedField === field) {
          this.copiedField = null;
        }
      }, 1600);
    } catch {
      this.copiedField = null;
    }
  }

  @HostListener('window:scroll')
  protected onWindowScroll(): void {
    if (
      this.isLoading ||
      this.loadError ||
      this.isNavigatingToContact ||
      this.selectedPhoto ||
      !this.hasMorePhotos ||
      this.autoLoadsUsed >= this.maxAutoLoads
    ) {
      return;
    }

    const scrollPosition = window.innerHeight + window.scrollY;
    const threshold = this.document.documentElement.scrollHeight - 320;

    if (scrollPosition >= threshold) {
      this.loadMorePhotos();
      this.autoLoadsUsed += 1;
    }
  }

  protected trackByPhotoId(_: number, photo: Photo): string {
    return photo.id;
  }

  protected getPhotoPlaceholder(photo: Photo): string {
    const cachedPlaceholder = this.blurhashCache.get(photo.id);

    if (cachedPlaceholder) {
      return cachedPlaceholder;
    }

    try {
      const width = 32;
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

  protected trackExternalLink(destination: 'instagram' | 'yoelvilla.dev'): void {
    this.analytics.trackEvent('external_link_click', {
      destination
    });
  }

  protected trackEmailClick(): void {
    this.analytics.trackEvent('contact_link_click', {
      destination: 'email'
    });
  }

  protected handleGalleryPhotoLoad(photo: Photo): void {
    this.loadedPhotoIds.add(photo.id);
    this.queueFullResolutionPhoto(photo);
  }

  protected isPhotoLoaded(photo: Photo): boolean {
    return this.loadedPhotoIds.has(photo.id);
  }

  protected getGalleryPhotoSrc(photo: Photo): string {
    return this.fullResolutionPhotoIds.has(photo.id) ? photo.src : photo.thumb;
  }

  protected shouldLoadPhoto(photo: Photo): boolean {
    return this.loadablePhotoIds.has(photo.id);
  }

  protected getPhotoLoading(index: number): 'eager' | 'lazy' {
    return index < this.highPriorityPhotoCount ? 'eager' : 'lazy';
  }

  protected getPhotoFetchPriority(index: number): 'high' | 'auto' {
    return index < this.highPriorityPhotoCount ? 'high' : 'auto';
  }

  private async loadPhotos(): Promise<void> {
    this.isLoading = true;
    this.loadError = false;

    try {
      this.photos = await this.loadPhotosManifestScript();
    } catch {
      this.loadError = true;
    } finally {
      this.isLoading = false;
    }
  }

  private loadPhotosManifestScript(): Promise<Photo[]> {
    const defaultView = this.document.defaultView as PhotosManifestWindow | null;

    return new Promise((resolve, reject) => {
      if (!defaultView) {
        reject(new Error('Window is not available'));
        return;
      }

      delete defaultView[PHOTOS_MANIFEST_GLOBAL_KEY];

      const script = this.document.createElement('script');
      script.async = true;
      script.src = PHOTOS_MANIFEST_SCRIPT_URL;

      script.addEventListener('load', () => {
        const photos = defaultView[PHOTOS_MANIFEST_GLOBAL_KEY];
        script.remove();

        if (!Array.isArray(photos)) {
          reject(new Error('Invalid photos manifest'));
          return;
        }

        resolve(photos);
      });

      script.addEventListener('error', () => {
        script.remove();
        reject(new Error('Could not load photos manifest'));
      });

      this.document.head.appendChild(script);
    });
  }

  private syncStateFromRoute(): void {
    const requestedView = this.route.snapshot.queryParamMap.get('view');
    const slug = this.route.snapshot.paramMap.get('slug');
    const routePath = this.route.snapshot.url[0]?.path;

    if (routePath && this.isGalleryKey(routePath)) {
      this.activeView = routePath;
    } else if (requestedView && this.isGalleryKey(requestedView)) {
      this.activeView = requestedView;
      if (!slug) {
        this.location.replaceState(this.createGalleryUrl(requestedView));
      }
    }

    if (!slug) {
      return;
    }

    const matchedPhoto = this.photos.find((photo) => photo.slug === slug);

    if (!matchedPhoto) {
      this.router.navigate(['/404']);
      return;
    }

    if (!requestedView) {
      this.activeView = matchedPhoto.category;
    }

    this.selectedPhoto = matchedPhoto;
  }

  private syncRouteView(): void {
    if (this.selectedPhoto) {
      return;
    }

    this.router.navigateByUrl(this.createGalleryUrl(this.activeView));
  }

  private isGalleryKey(value: string): value is GalleryKey {
    return GALLERY_KEYS.includes(value as GalleryKey);
  }

  private showAdjacentPhoto(direction: -1 | 1): void {
    if (!this.selectedPhoto) {
      return;
    }

    const currentIndex = this.filteredPhotos.findIndex(
      (photo) => photo.id === this.selectedPhoto?.id
    );
    const adjacentPhoto = this.filteredPhotos[currentIndex + direction];

    if (!adjacentPhoto) {
      return;
    }

    this.selectedPhoto = adjacentPhoto;
    this.preloadAdjacentViewerPhotos(adjacentPhoto);
    this.analytics.trackEvent('photo_navigate', {
      direction: direction === -1 ? 'previous' : 'next',
      photo_slug: adjacentPhoto.slug,
      photo_title: adjacentPhoto.title,
      category: adjacentPhoto.category,
      gallery_view: this.activeView
    });
    this.location.go(this.createPhotoUrl(adjacentPhoto.slug));
  }

  private getSelectedPhotoIndex(): number {
    if (!this.selectedPhoto) {
      return -1;
    }

    return this.filteredPhotos.findIndex(
      (photo) => photo.id === this.selectedPhoto?.id
    );
  }

  private queueInitialPhotos(): void {
    for (const photo of this.visiblePhotos.slice(0, this.highPriorityPhotoCount)) {
      this.loadablePhotoIds.add(photo.id);
    }
  }

  private createIntersectionObserver(): void {
    if (!this.document.defaultView || this.intersectionObserver) {
      return;
    }

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }

          const photoId = (entry.target as HTMLElement).dataset['photoId'];

          if (photoId) {
            this.loadablePhotoIds.add(photoId);
            this.intersectionObserver?.unobserve(entry.target);
            this.changeDetector.detectChanges();
          }
        }
      },
      { rootMargin: '600px 0px' }
    );
  }

  private observeRenderedPhotos(): void {
    this.createIntersectionObserver();

    if (!this.intersectionObserver || !this.photoCardFigures) {
      return;
    }

    for (const figure of this.photoCardFigures) {
      const photoId = figure.nativeElement.dataset['photoId'];

      if (!photoId || this.observedPhotoIds.has(photoId)) {
        continue;
      }

      this.observedPhotoIds.add(photoId);
      this.intersectionObserver.observe(figure.nativeElement);
    }
  }

  private preloadUpcomingGalleryPhotos(): void {
    const photosToPreload = this.filteredPhotos
      .slice(this.visibleCount, this.visibleCount + 4)
      .map((photo) => photo.thumb);

    for (const photo of this.visiblePhotos.slice(0, this.highPriorityPhotoCount)) {
      photosToPreload.push(photo.thumb);
    }

    this.preloadImageUrls(photosToPreload);
  }

  private preloadAdjacentViewerPhotos(photo: Photo): void {
    const currentIndex = this.filteredPhotos.findIndex(
      (filteredPhoto) => filteredPhoto.id === photo.id
    );

    this.preloadImageUrls(
      [this.filteredPhotos[currentIndex - 1]?.src, this.filteredPhotos[currentIndex + 1]?.src]
        .filter((src): src is string => Boolean(src))
    );
  }

  private preloadImageUrls(urls: string[]): void {
    for (const url of urls) {
      if (this.preloadedImageUrls.has(url)) {
        continue;
      }

      this.preloadedImageUrls.add(url);
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
    }
  }

  private queueFullResolutionPhoto(photo: Photo): void {
    if (
      photo.src === photo.thumb ||
      this.fullResolutionPhotoIds.has(photo.id) ||
      this.queuedFullResolutionPhotoIds.has(photo.id)
    ) {
      if (photo.src === photo.thumb) {
        this.fullResolutionPhotoIds.add(photo.id);
      }

      return;
    }

    this.queuedFullResolutionPhotoIds.add(photo.id);
    this.fullResolutionPreloadQueue.push(photo);
    window.setTimeout(() => this.drainFullResolutionPreloadQueue());
  }

  private drainFullResolutionPreloadQueue(): void {
    while (
      this.activeFullResolutionPreloads < this.fullResolutionPreloadConcurrency &&
      this.fullResolutionPreloadQueue.length > 0
    ) {
      const photo = this.fullResolutionPreloadQueue.shift();

      if (!photo) {
        continue;
      }

      this.preloadFullResolutionPhoto(photo);
    }
  }

  private preloadFullResolutionPhoto(photo: Photo): void {
    if (this.loadedFullResolutionImageUrls.has(photo.src)) {
      this.fullResolutionPhotoIds.add(photo.id);
      this.changeDetector.detectChanges();
      return;
    }

    this.activeFullResolutionPreloads += 1;

    const image = new Image();
    image.decoding = 'async';
    image.setAttribute('fetchpriority', 'low');

    image.onload = () => {
      this.loadedFullResolutionImageUrls.add(photo.src);
      this.preloadedImageUrls.add(photo.src);
      this.fullResolutionPhotoIds.add(photo.id);
      this.activeFullResolutionPreloads -= 1;
      this.changeDetector.detectChanges();
      this.drainFullResolutionPreloadQueue();
    };

    image.onerror = () => {
      this.activeFullResolutionPreloads -= 1;
      this.drainFullResolutionPreloadQueue();
    };

    image.src = photo.src;
  }

  private createPhotoUrl(slug: string): string {
    return `/foto/${encodeURIComponent(slug)}`;
  }

  private createGalleryUrl(view: GalleryKey): string {
    return view === 'home' ? '/' : `/${view}`;
  }
}
