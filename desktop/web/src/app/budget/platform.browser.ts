export async function deliverBudgetCsv(data: string, defaultName: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = defaultName
  link.style.display = 'none'
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    URL.revokeObjectURL(url)
  }
}
