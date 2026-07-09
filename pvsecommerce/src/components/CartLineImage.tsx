import { resolveImageSet, resolveUploadUrl } from "@/lib/api";
import { PackagingArt } from "@/components/PackagingArt";
import type { CartLine } from "@/lib/api";

interface Props {
  line: CartLine;
  className?: string;
}

export const CartLineImage = ({ line, className = "" }: Props) => {
  const hint = line.packagingHint;
  if (!line.imageUrl) {
    return (
      <div className={className}>
        <PackagingArt kind={hint} />
      </div>
    );
  }

  const imgSet = resolveImageSet(line.imageUrl, line.imageUpdatedAt);
  const fallback = resolveUploadUrl(line.imageUrl, line.imageUpdatedAt);

  return (
    <div className={className}>
      {imgSet ? (
        <picture>
          <source type="image/webp" srcSet={imgSet.thumb.webp} />
          <img
            src={imgSet.thumb.jpeg}
            alt=""
            className="cart-line-photo"
            loading="lazy"
            decoding="async"
          />
        </picture>
      ) : (
        <img
          src={fallback}
          alt=""
          className="cart-line-photo"
          loading="lazy"
          decoding="async"
        />
      )}
    </div>
  );
};
