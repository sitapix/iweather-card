export async function copyYaml(code: HTMLElement): Promise<string> {
  try {
    await navigator.clipboard.writeText(code.textContent);
    return 'YAML copied';
  } catch {
    const selection = document.getSelection();
    selection?.selectAllChildren(code);
    return selection?.toString() ? 'YAML selected. Use your device’s Copy command.' : 'Select the YAML to copy it.';
  }
}
