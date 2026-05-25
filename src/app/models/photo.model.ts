export type PhotoCategory = 'costa' | 'montana' | 'nocturnas' | 'ciudad';

// Stable asset shape so the source can move from local JSON to S3 later
// without changing the components that consume photos.
export interface Photo {
  id: string;
  slug: string;

  title: string;
  category: PhotoCategory;
  location: string;

  src: string;
  thumb: string;

  alt: string;

  width: number;
  height: number;

  blurhash: string;
  dominantColor: string;
}
