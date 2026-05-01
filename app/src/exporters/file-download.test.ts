import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('downloadFile', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('creates an anchor with download attribute and clicks it', async () => {
    const { downloadFile } = await import('./file-download');
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const clicked = vi.fn();

    // Spy on anchor click
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        el.click = clicked;
      }
      return el;
    });

    downloadFile(blob, 'export.txt');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
