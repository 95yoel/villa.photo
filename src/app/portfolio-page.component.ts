import { CommonModule, DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  AfterViewInit,
  Component,
  HostListener,
  Inject,
  inject
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Photo, PhotoCategory } from './models/photo.model';
import { PhotoViewerComponent } from './photo-viewer.component';

const PHOTOS_MANIFEST_URL = 'https://d1fmx8ncgs4siw.cloudfront.net/photos.json';

type GalleryKey = 'home' | PhotoCategory;

interface NavItem {
  id: 'home' | GalleryKey | 'contacto';
  label: string;
}

@Component({
  selector: 'app-portfolio-page',
  imports: [CommonModule, PhotoViewerComponent],
  templateUrl: './portfolio-page.component.html',
  styleUrl: './portfolio-page.component.css'
})
export class PortfolioPageComponent implements AfterViewInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

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

  protected activeView: GalleryKey = 'home';
  protected photos: Photo[] = [];
  protected visibleCount = this.initialVisibleCount;
  protected selectedPhoto: Photo | null = null;
  protected isLoading = true;
  protected loadError = false;
  protected autoLoadsUsed = 0;
  protected copiedField: 'email' | 'instagram' | null = null;

  private isNavigatingToContact = false;

  constructor(@Inject(DOCUMENT) private readonly document: Document) {}

  async ngAfterViewInit(): Promise<void> {
    await this.loadPhotos();
    this.syncStateFromRoute();
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

  protected selectView(view: GalleryKey): void {
    this.activeView = view;
    this.visibleCount = this.initialVisibleCount;
    this.autoLoadsUsed = 0;
    this.syncQueryView();
  }

  protected scrollToHome(): void {
    this.activeView = 'home';
    this.visibleCount = this.initialVisibleCount;
    this.autoLoadsUsed = 0;
    this.syncQueryView();
    this.document.defaultView?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected scrollToContact(): void {
    this.isNavigatingToContact = true;
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
  }

  protected openPhoto(photo: Photo): void {
    this.selectedPhoto = photo;
    this.router.navigate(['/foto', photo.slug], {
      queryParams: { view: this.activeView }
    });
  }

  protected closePhoto(): void {
    this.selectedPhoto = null;
    this.router.navigate(['/'], {
      queryParams: this.activeView === 'home' ? {} : { view: this.activeView }
    });
  }

  protected async copyText(
    value: string,
    field: 'email' | 'instagram'
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copiedField = field;

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

  private async loadPhotos(): Promise<void> {
    this.isLoading = true;
    this.loadError = false;

    try {
      this.photos = await firstValueFrom(
        this.http.get<Photo[]>(PHOTOS_MANIFEST_URL)
      );
    } catch {
      this.loadError = true;
    } finally {
      this.isLoading = false;
    }
  }

  private syncStateFromRoute(): void {
    const requestedView = this.route.snapshot.queryParamMap.get('view');
    const slug = this.route.snapshot.paramMap.get('slug');

    if (requestedView && this.isGalleryKey(requestedView)) {
      this.activeView = requestedView;
    }

    if (!slug) {
      return;
    }

    const matchedPhoto = this.photos.find((photo) => photo.slug === slug);

    if (!matchedPhoto) {
      this.router.navigate(['/'], {
        queryParams: this.activeView === 'home' ? {} : { view: this.activeView }
      });
      return;
    }

    if (!requestedView) {
      this.activeView = matchedPhoto.category;
    }

    this.selectedPhoto = matchedPhoto;
  }

  private syncQueryView(): void {
    if (this.selectedPhoto) {
      return;
    }

    this.router.navigate(['/'], {
      queryParams: this.activeView === 'home' ? {} : { view: this.activeView }
    });
  }

  private isGalleryKey(value: string): value is GalleryKey {
    return ['home', 'costa', 'montana', 'nocturnas', 'ciudad'].includes(value);
  }
}
