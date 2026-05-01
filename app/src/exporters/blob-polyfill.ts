// Polyfill Blob.text() for jsdom environment which lacks it.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.text === 'undefined') {
  Blob.prototype.text = function (): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer === 'undefined') {
  Blob.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
