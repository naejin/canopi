import { useEffect, useMemo } from 'preact/hooks';
import { createPlantMediaController } from '../../app/plant-detail';
import { photoFromCatalogUrl } from '../species-detail/photo-attribution';
import { PhotoViewer, type PhotoViewerModel } from '../species-detail/PhotoViewer';

/** Desktop photos: the plant DB's photo list, each served from the native image cache. */
export function PhotoCarousel({ canonicalName, name }: { canonicalName: string; name: string }) {
  const media = useMemo(() => createPlantMediaController(), []);

  useEffect(() => {
    media.setCanonicalName(canonicalName);
  }, [canonicalName, media]);

  useEffect(() => () => media.dispose(), [media]);

  const images = media.images.value;
  const photos = useMemo(() => images.map((image) => photoFromCatalogUrl(image.url)), [images]);
  const model: PhotoViewerModel = {
    photos,
    loading: media.loading.value,
    index: media.currentIndex.value,
    src: media.loadedSrc.value,
    ready: media.imageReady.value,
    failed: media.loadFailed.value,
    select: (index) => media.setCurrentIndex(index),
    next: () => media.goNext(),
    prev: () => media.goPrev(),
    loaded: () => media.markImageLoaded(),
    errored: () => media.handleImageError(),
  };

  return <PhotoViewer model={model} name={name} linkSources={false} />;
}
