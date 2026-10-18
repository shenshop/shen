import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/lib/types";
import { formatPrice } from "@/lib/format";
import { CardBuy } from "./card-buy";

export function ProductCard({ product, priority = false }: { product: Product; priority?: boolean }) {
  const image = product.images[0];
  const discount = product.oldPrice ? Math.round((1 - product.price / product.oldPrice) * 100) : 0;
  return (
    <div className="card">
      <Link href={`/product/${product.slug}`} className="card-link">
        <div className="card-image">
          <Image
            src={image}
            alt={product.name}
            fill
            sizes="(max-width: 700px) 50vw, (max-width: 1100px) 33vw, 25vw"
            priority={priority}
            unoptimized={image.endsWith(".svg")}
          />
          {discount > 0 && <span className="tag">−{discount}%</span>}
        </div>
        <div className="card-body">
          <p className="card-name">{product.name}</p>
          <p className="card-price">
            <strong>{formatPrice(product.price)}</strong>
            {product.oldPrice && <s>{formatPrice(product.oldPrice)}</s>}
          </p>
        </div>
      </Link>
      <CardBuy product={product} />
    </div>
  );
}
