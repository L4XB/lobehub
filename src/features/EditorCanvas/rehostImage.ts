import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { fileService } from '@/services/file';

import { getRegisteredAttachment, registerAttachment } from './attachmentRegistry';

export const needsImageRehost = (src: string): boolean => {
  if (getRegisteredAttachment(src)) return false;

  try {
    const url = new URL(src, window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return url.origin !== window.location.origin || !url.pathname.startsWith('/f/');
  } catch {
    return false;
  }
};

export const rehostImage = async (src: string): Promise<{ url: string }> => {
  try {
    const result = await fileService.rehostImage(new URL(src, window.location.origin).href);
    registerAttachment(result.url, result.fileId);
    return { url: result.url };
  } catch (error) {
    toast.error(t('uploadDock.body.item.error', { ns: 'file' }));
    throw error;
  }
};
