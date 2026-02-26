interface PdfFooterProps {
  brandName: string;
  page: number;
  totalPages: number;
}

export function PdfFooter({ brandName, page, totalPages }: PdfFooterProps) {
  return (
    <div className="print-footer">
      <span>{brandName}</span>
      <span>Page {page} of {totalPages}</span>
      <span>&copy; {new Date().getFullYear()} {brandName}</span>
    </div>
  );
}
