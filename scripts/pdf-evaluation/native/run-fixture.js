// Injected only into the isolated native test windows, never the production app.
void (async () => {
  const send = value => {
    const message = JSON.stringify(value);
    if (window.chrome?.webview) window.chrome.webview.postMessage(message);
    else window.webkit.messageHandlers.canopiEvaluation.postMessage(message);
  };
  try {
    const deadline = performance.now() + 15_000;
    while (!window.evaluation) {
      if (performance.now() > deadline) throw new Error('Evaluation module did not load');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const report = await window.evaluation.run('pdfkit');
    const bytes = new Uint8Array(await window.evaluation.bytes());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const previews = [...document.querySelectorAll('#previews canvas')].map(canvas => canvas.toDataURL('image/png').split(',')[1]);
    if (previews.length !== 3) throw new Error('Expected three rendered preview canvases');
    send({ report, pdf: btoa(binary), previews });
  } catch (error) {
    send({ error: String(error), stack: error?.stack });
  }
})();
