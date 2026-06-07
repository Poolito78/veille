export default function ColResizeHandle(props: {
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      {...props}
      title="Glisser pour redimensionner · double-clic pour réinitialiser"
      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 z-10"
    />
  );
}
