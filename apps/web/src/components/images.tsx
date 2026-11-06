import { IMAGE_MAX_BYTES, IMAGE_TYPES } from '@pothgula/shared';
import { type ChangeEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../api/errors';
import { imageUrl } from '../api/queries';
import { Alert, Button } from './ui';

/**
 * A logo, or the name in plain text when there is none (FR-BRN-04: a branch
 * with no logo shows the library-wide logo, or the name if there is none).
 */
export function Logo({
  imageId,
  name,
  size = 'md',
}: {
  imageId: number | null | undefined;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const box = { sm: 'h-8 w-8', md: 'h-12 w-12', lg: 'h-20 w-20' }[size];
  if (!imageId) {
    return (
      <span
        aria-hidden="true"
        className={`${box} inline-flex shrink-0 items-center justify-center rounded-md bg-emerald-900 font-semibold text-white`}
      >
        {[...name.trim()][0] ?? '?'}
      </span>
    );
  }
  return (
    <img
      src={imageUrl(imageId, size === 'lg' ? 'full' : 'thumb')}
      alt=""
      className={`${box} shrink-0 rounded-md object-contain`}
    />
  );
}

/**
 * Chooses and uploads one image. The type and the 2 MB limit are checked here
 * for a quick answer; the API checks the real content again (NFR-16).
 */
export function ImageUploadButton({
  label,
  onUpload,
}: {
  label: string;
  onUpload: (file: File) => Promise<void>;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function chosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setError(t('errors.image_type'));
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setError(t('errors.image_too_large'));
      return;
    }
    setBusy(true);
    try {
      await onUpload(file);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={input}
        id={id}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        className="sr-only"
        onChange={(e) => void chosen(e)}
        aria-label={label}
      />
      <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? t('images.uploading') : label}
      </Button>
      <p className="text-xs text-stone-600">{t('images.rules')}</p>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

export function imageForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}
