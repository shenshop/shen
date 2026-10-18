export type Category = {
  id: number;
  name: string;
  slug: string;
  parentId: number | null;
};

export type Variant = {
  id: number;
  sku: string;
  size: string;
  price: number;
  inStock: boolean;
};

export type Product = {
  id: number;
  slug: string;
  name: string;
  description: string;
  price: number;
  oldPrice: number | null;
  images: string[];
  categoryId: number | null;
  variants: Variant[];
};

export type CartItem = {
  productId: number;
  variantId: number;
  sku: string;
  name: string;
  size: string;
  price: number;
  image: string;
  quantity: number;
};

export type DeliveryService = "novaposhta" | "ukrposhta";

export type OrderRequest = {
  name: string;
  phone: string;
  comment?: string;
  delivery?: {
    service: DeliveryService;
    city: string;
    cityRef?: string;
    point: string;
    warehouseRef?: string;
    zip?: string;
  };
  payment: "cod" | "prepay";
  items: Pick<CartItem, "sku" | "name" | "size" | "price" | "quantity" | "image">[];
  utm?: Record<string, string>;
  quick?: boolean;
};
