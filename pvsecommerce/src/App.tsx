// Router + provider tree. The Layout component is the persistent
// shell (header, footer, slide-in cart drawer); pages render into
// <Outlet>. Account routes live under their own nested layout that
// guards on auth.

import {
  createBrowserRouter,
  RouterProvider,
} from "react-router-dom";
import { Layout } from "@/components/Layout";
import { HomePage } from "@/pages/HomePage";
import { CategoryPage } from "@/pages/CategoryPage";
import { CartPage } from "@/pages/CartPage";
import { CheckoutPage } from "@/pages/CheckoutPage";
import { OrderSuccessPage } from "@/pages/OrderSuccessPage";
import { LoginPage } from "@/pages/LoginPage";
import { AccountLayout } from "@/pages/AccountLayout";
import { AccountOverview } from "@/pages/AccountOverview";
import { AccountOrders } from "@/pages/AccountOrders";
import { AccountWishlist } from "@/pages/AccountWishlist";
import { AccountAddresses } from "@/pages/AccountAddresses";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ProductDetailPage } from "@/pages/ProductDetailPage";
import { CartProvider } from "@/state/CartContext";
import { WishlistProvider } from "@/state/WishlistContext";
import { AuthProvider } from "@/state/AuthContext";
import { ToastProvider } from "@/state/ToastContext";
import { CatalogProvider } from "@/state/CatalogContext";

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/category/:slug", element: <CategoryPage /> },
      { path: "/product/:id", element: <ProductDetailPage /> },
      { path: "/cart", element: <CartPage /> },
      { path: "/checkout", element: <CheckoutPage /> },
      { path: "/order/:soNo", element: <OrderSuccessPage /> },
      { path: "/login", element: <LoginPage /> },
      {
        path: "/account",
        element: <AccountLayout />,
        children: [
          { index: true, element: <AccountOverview /> },
          { path: "orders", element: <AccountOrders /> },
          { path: "wishlist", element: <AccountWishlist /> },
          { path: "addresses", element: <AccountAddresses /> },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

export const App = () => (
  <ToastProvider>
    <AuthProvider>
      <WishlistProvider>
        <CartProvider>
          <CatalogProvider>
            <RouterProvider router={router} />
          </CatalogProvider>
        </CartProvider>
      </WishlistProvider>
    </AuthProvider>
  </ToastProvider>
);
