export function droppedFiles(transfer: DataTransfer): File[] {
    if (!transfer.items.length) return Array.from(transfer.files);

    const files: File[] = [];

    for (const item of Array.from(transfer.items)) {
        if (item.kind !== 'file') continue;
        if (item.webkitGetAsEntry?.()?.isDirectory) continue;

        const file = item.getAsFile();
        if (file) files.push(file);
    }

    return files;
}
