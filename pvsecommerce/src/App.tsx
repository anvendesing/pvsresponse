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
import { ConcernPage } from "@/pages/ConcernPage";
import { ConcernsIndexPage } from "@/pages/ConcernsIndexPage";
import { CartPage } from "@/pages/CartPage";
import { CheckoutPage } from "@/pages/CheckoutPage";
import { OrderSuccessPage } from "@/pages/OrderSuccessPage";
import { TrackOrderPage } from "@/pages/TrackOrderPage";
import { LoginPage } from "@/pages/LoginPage";
import { AccountLayout } from "@/pages/AccountLayout";
import { AccountOverview } from "@/pages/AccountOverview";
import { AccountOrders } from "@/pages/AccountOrders";
import { AccountWishlist } from "@/pages/AccountWishlist";
import { AccountAddresses } from "@/pages/AccountAddresses";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ProductDetailPage } from "@/pages/ProductDetailPage";
import { EnquiryPage } from "@/pages/EnquiryPage";
import { BulkOrderPage } from "@/pages/BulkOrderPage";
import { CartProvider } from "@/state/CartContext";
import { WishlistProvider } from "@/state/WishlistContext";
import { AuthProvider } from "@/state/AuthContext";
import { ToastProvider } from "@/state/ToastContext";
import { CatalogProvider } from "@/state/CatalogContext";
import { CategoriesProvider } from "@/state/CategoriesContext";
import { ConcernsProvider } from "@/state/ConcernsContext";
import { PlatformProvider } from "@/state/PlatformContext";

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/category/:slug", element: <CategoryPage /> },
      { path: "/concerns", element: <ConcernsIndexPage /> },
      { path: "/concern/:slug", element: <ConcernPage /> },
      { path: "/product/:id", element: <ProductDetailPage /> },
      { path: "/enquiry", element: <EnquiryPage /> },
      { path: "/cart", element: <CartPage /> },
      { path: "/bulk-order", element: <BulkOrderPage /> },
      { path: "/checkout", element: <CheckoutPage /> },
      { path: "/order/:soNo", element: <OrderSuccessPage /> },
      { path: "/track", element: <TrackOrderPage /> },
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
  <PlatformProvider>
    <ToastProvider>
      <AuthProvider>
        <WishlistProvider>
          <CartProvider>
            <CategoriesProvider>
              <ConcernsProvider>
                <CatalogProvider>
                  <RouterProvider router={router} />
                </CatalogProvider>
              </ConcernsProvider>
            </CategoriesProvider>
          </CartProvider>
        </WishlistProvider>
      </AuthProvider>
    </ToastProvider>
  </PlatformProvider>
);
