import { render } from 'preact'
import '../../src/styles/global.css'
import '../../src/i18n'
import { LibraryReference } from './LibraryReference'

if (!import.meta.env.DEV) throw new Error('The library reference is development-only.')
const root = document.getElementById('app')!
render(<LibraryReference />, root)
if (import.meta.hot) import.meta.hot.dispose(() => render(null, root))
