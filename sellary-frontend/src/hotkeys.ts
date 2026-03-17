type KeyHandler = (e: KeyboardEvent) => void;

interface HotkeyConfig {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: KeyHandler;
  description: string;
}

class HotkeyManager {
  private hotkeys: HotkeyConfig[] = [];

  register(config: HotkeyConfig) {
    this.hotkeys.push(config);
  }

  unregister(key: string) {
    this.hotkeys = this.hotkeys.filter((h) => h.key === key);
  }

  handleKeyDown(e: KeyboardEvent) {
    // Don't trigger when typing in input fields
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.contentEditable === 'true'
    ) {
      // Allow F2 (focus barcode) even when in input
      if (e.key !== 'F2') {
        return;
      }
    }

    for (const hotkey of this.hotkeys) {
      const keyMatch = e.key.toLowerCase() === hotkey.key.toLowerCase() ||
                       e.code === hotkey.key;
      const ctrlMatch = hotkey.ctrl === undefined || e.ctrlKey === hotkey.ctrl;
      const shiftMatch = hotkey.shift === undefined || e.shiftKey === hotkey.shift;
      const altMatch = hotkey.alt === undefined || e.altKey === hotkey.alt;

      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        e.preventDefault();
        hotkey.handler(e);
        return;
      }
    }
  }

  getHotkeysList(): HotkeyConfig[] {
    return [...this.hotkeys];
  }
}

export const hotkeyManager = new HotkeyManager();

export const registerHotkeys = () => {
  document.addEventListener('keydown', (e) => hotkeyManager.handleKeyDown(e));
};

export default hotkeyManager;
