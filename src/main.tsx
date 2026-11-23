import { render } from 'preact';
import { App } from './app';
import './styles.css';
import { applyTheme, loadTheme } from './theme';

// The chosen look (index.html already put it on before the first paint; this keeps the two in step)
applyTheme(loadTheme());

// Behave like an app, not a web page: iPhone Safari still zooms the page on a pinch whatever the
// viewport says, so its zoom gesture is cancelled everywhere (the calendar handles its own pinch)
for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, e => e.preventDefault(), { passive: false });

render(<App />, document.getElementById('app')!);
