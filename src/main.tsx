import { render } from 'preact';
import { App } from './app';
import './styles.css';

// Behave like an app, not a web page: iPhone Safari still zooms the page on a pinch whatever the
// viewport says, so its zoom gesture is cancelled everywhere (the calendar handles its own pinch)
for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, e => e.preventDefault(), { passive: false });

render(<App />, document.getElementById('app')!);
