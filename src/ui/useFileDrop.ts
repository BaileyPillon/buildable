// A statement dropped anywhere on the page, not just on the dropzone box. Without this the browser's default takes
// over: it opens (or downloads) the file in the tab and the app, with anything loaded in it, is gone.
import { useEffect, useRef, useState } from 'react';

/** True for a drag that carries files (as opposed to selected text or a link). */
export function isFileDrag(e: { dataTransfer: { types?: readonly string[] | DOMStringList } | null }): boolean {
  const types = e.dataTransfer?.types;
  return !!types && Array.from(types as ArrayLike<string>).includes('Files');
}

/**
 * Registers page-wide dragover/drop handlers for the life of the app. Every file drop is cancelled so the browser
 * never navigates away. When `onFiles` is set the files go to it, and the returned flag is true while a file is
 * being dragged over the page (so the dropzone can light up). Pass null where a drop should do nothing: the results
 * view, or while a statement is being read.
 */
export function useFileDrop(onFiles: ((files: File[]) => void) | null): boolean {
  const [over, setOver] = useState(false);
  const handler = useRef(onFiles);
  handler.current = onFiles;

  useEffect(() => {
    let timer: number | undefined;
    // dragover repeats about every 50 ms while a drag hovers; when it stops, the drag has left or ended
    const onDragOver = (e: DragEvent): void => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = handler.current ? 'copy' : 'none';
      if (!handler.current) return;
      setOver(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setOver(false), 200);
    };
    const onDrop = (e: DragEvent): void => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      window.clearTimeout(timer);
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (handler.current && files.length > 0) handler.current(files);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return over;
}
