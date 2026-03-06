/**
 * Shared domain types and the adapter interface that every grocery store
 * backend must implement.
 *
 * server.ts depends ONLY on this file — never on a concrete store.
 */

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface Product {
  id: string;
  name: string;
  price?: string;
  unit?: string;
  imageUrl?: string;
  productUrl?: string;
}

export interface CartItem {
  productId: string;
  name: string;
  price?: string;
  quantity: number;
  productUrl?: string;
  imageUrl?: string;
}

export interface CartContents {
  items: CartItem[];
  totalItems: number;
  totalPrice?: string;
}


// ---------------------------------------------------------------------------
// Adapter interface — one implementation per store chain
// ---------------------------------------------------------------------------

export interface GroceryStore {
  /** Human-readable name, e.g. "ICA", "Willys". */
  readonly name: string;

  /**
   * Initialise a session bound to a specific store location.
   * Must be called before any other method.
   */
  setStore(storeId: string): Promise<void>;

  /** Authenticate with username / password. */
  login(username: string, password: string): Promise<void>;

  /** Search for products by free-text query. */
  searchProducts(query: string): Promise<Product[]>;

  /** Add a product to the cart. */
  addToCart(productId: string, quantity: number): Promise<{ success: boolean; message: string }>;

  /** Set a product's quantity (0 = remove). */
  editCart(productId: string, quantity: number): Promise<{ success: boolean; message: string }>;

  /** Return the current cart contents. */
  getCart(): Promise<CartContents>;


  /** Tear down any resources held by the adapter. */
  close(): Promise<void>;
}

