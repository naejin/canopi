// Injected only by the native validation hosts. The app contains no test hook.
void (async () => {
  const send = (value) => {
    const message = JSON.stringify(value)
    if (window.chrome?.webview) window.chrome.webview.postMessage(message)
    else window.webkit.messageHandlers.canopiEvaluation.postMessage(message)
  }
  try {
    const deadline = performance.now() + 15_000
    while (!window.pdfValidation) {
      if (performance.now() > deadline) throw new Error('Production validation module did not load')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const report = await window.pdfValidation.run('mixed')
    let binary = ''
    for (const byte of window.pdfValidation.bytes()) binary += String.fromCharCode(byte)
    const previews = []
    for (let i = 0; i < 3; i++) previews.push(await window.pdfValidation.png(i))
    send({ report, pdf: btoa(binary), previews })
  } catch (error) { send({ error: String(error), stack: error?.stack }) }
})()
