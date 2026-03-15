/**
 * In-memory mock implementation of GroceryStore for unit testing.
 *
 * - Tracks all method calls for assertion.
 * - Maintains an in-memory product catalogue and cart.
 * - Allows tests to configure behaviour (e.g. force errors).
 */

import type {
  GroceryStore,
  Product,
  CartItem,
  CartContents,
} from '../../src/stores/types';

// ---------------------------------------------------------------------------
// Canned product catalogue
// ---------------------------------------------------------------------------

export const MOCK_PRODUCTS: Product[] = [
  {
    id: '1001',
    name: 'Mjölk 3% 1L',
    price: '15.90 SEK',
    unit: '1L',
    imageUrl: 'https://example.com/milk.jpg',
    productUrl: 'https://example.com/products/1001',
  },
  {
    id: '1002',
    name: 'Ägg 12-pack',
    price: '42.00 SEK',
    unit: '12-pack',
    imageUrl: 'https://example.com/eggs.jpg',
    productUrl: 'https://example.com/products/1002',
  },
  {
    id: '1003',
    name: 'Bröd Pågen Lingon',
    price: '29.90 SEK',
    unit: '500g',
    imageUrl: 'https://example.com/bread.jpg',
    productUrl: 'https://example.com/products/1003',
  },
];

// ---------------------------------------------------------------------------
// Mock store
// ---------------------------------------------------------------------------

export class MockStore implements GroceryStore {
  readonly name = 'MockStore';

  // --- observable state for assertions ---
  storeId: string | undefined;
  loggedInUser: string | undefined;
  closeCalled = false;
  setStoreCalls = 0;
  loginCalls = 0;

  // --- configurable behaviour ---
  /** When set, `login()` will throw with this message. */
  loginError: string | undefined;
  /** When set, `addToCart()` will return `{ success: false, message }`. */
  addToCartError: string | undefined;
  /** When set, `removeFromCart()` will return `{ success: false, message }`. */
  removeFromCartError: string | undefined;

  /** When set, `getFavourites()` will throw with this message. */
  getFavouritesError: string | undefined;
  /** When set, `getPurchaseHistory()` will throw with this message. */
  getPurchaseHistoryError: string | undefined;

  // --- in-memory cart ---
  private cart = new Map<string, CartItem>();

  private productById(id: string): Product | undefined {
    return MOCK_PRODUCTS.find((p) => p.id === id);
  }

  // --- GroceryStore implementation ---

  async setStore(storeId: string): Promise<void> {
    this.storeId = storeId;
    this.setStoreCalls++;
  }

  async login(username: string, password: string): Promise<void> {
    if (this.loginError) {
      throw new Error(this.loginError);
    }
    this.loggedInUser = username;
    this.loginCalls++;
  }

  async searchProducts(query: string): Promise<Product[]> {
    const q = query.toLowerCase();
    return MOCK_PRODUCTS.filter((p) => p.name.toLowerCase().includes(q));
  }

  async addToCart(
    productId: string,
    quantity: number,
  ): Promise<{ success: boolean; message: string }> {
    if (this.addToCartError) {
      return { success: false, message: this.addToCartError };
    }

    const existing = this.cart.get(productId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      const product = this.productById(productId);
      this.cart.set(productId, {
        productId,
        name: product?.name ?? 'Unknown',
        price: product?.price,
        quantity,
        productUrl: product?.productUrl,
        imageUrl: product?.imageUrl,
      });
    }

    return { success: true, message: `Product ${productId} quantity adjusted by ${quantity}.` };
  }

  async removeFromCart(
    productId: string,
    quantity: number,
  ): Promise<{ success: boolean; message: string }> {
    if (this.removeFromCartError) {
      return { success: false, message: this.removeFromCartError };
    }

    const existing = this.cart.get(productId);
    if (!existing) {
      return { success: true, message: `Product ${productId} is not in the cart.` };
    }

    const toRemove = Math.min(quantity, existing.quantity);
    existing.quantity -= toRemove;

    if (existing.quantity <= 0) {
      this.cart.delete(productId);
      return { success: true, message: `Product ${productId} removed from cart.` };
    }

    return { success: true, message: `Product ${productId} quantity reduced by ${toRemove} (now ${existing.quantity}).` };
  }


  async getCart(): Promise<CartContents> {
    const items = Array.from(this.cart.values());
    const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
    return { items, totalItems, totalPrice: '0.00 SEK' };
  }

  async getFavourites(): Promise<Product[]> {
    if (this.getFavouritesError) {
      throw new Error(this.getFavouritesError);
    }
    // Return first two mock products as favourites
    return MOCK_PRODUCTS.slice(0, 2);
  }

  async getPurchaseHistory(): Promise<Product[]> {
    if (this.getPurchaseHistoryError) {
      throw new Error(this.getPurchaseHistoryError);
    }
    // Return last two mock products as purchase history
    return MOCK_PRODUCTS.slice(1);
  }

  async close(): Promise<void> {
    this.closeCalled = true;
    this.cart.clear();
  }
}

