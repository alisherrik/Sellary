'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Product } from './types';
import { RESTAURANT_STORAGE_KEY, createCompanyScopedJSONStorage } from './session';
import { useAuthStore } from './store';

export type TableStatus = 'empty' | 'ordering' | 'waiting' | 'served' | 'paying';

export interface OrderItem {
  id: string;
  product: Product;
  quantity: number;
  note?: string;
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'served';
  createdAt: string;
}

export interface TableOrder {
  id: string;
  tableName: string;
  items: OrderItem[];
  status: TableStatus;
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
  waiterName?: string;
  guestCount?: number;
  notes?: string;
}

export interface Table {
  name: string;
  status: TableStatus;
  currentOrderId?: string;
  capacity: number;
}

interface RestaurantState {
  // Tables
  tables: Table[];

  // Active orders by table
  activeOrders: Record<string, TableOrder>;

  // Current editing
  selectedTable: string | null;
  currentOrderItems: OrderItem[];

  // Category filter
  selectedCategory: number | null;

  // Actions - Tables
  initializeTables: () => void;
  selectTable: (tableName: string) => void;
  clearSelection: () => void;
  getTableOrder: (tableName: string) => TableOrder | undefined;

  // Actions - Order Management
  addItemToOrder: (product: Product) => void;
  removeItemFromOrder: (itemId: string) => void;
  updateItemQuantity: (itemId: string, quantity: number) => void;
  setItemNote: (itemId: string, note: string) => void;

  // Actions - Order Workflow
  confirmOrder: (guestCount?: number, notes?: string) => string; // Returns order ID
  addMoreItems: (tableName: string) => void; // Add more items to existing order
  markItemAsReady: (tableName: string, itemId: string) => void;
  markItemAsServed: (tableName: string, itemId: string) => void;
  markAllAsServed: (tableName: string) => void;
  requestBill: (tableName: string) => void;
  completePayment: (tableName: string, paymentMethod: string, cardType?: string) => void;
  cancelOrder: (tableName: string) => void;

  // Calculations
  getCurrentOrderTotal: () => number;
  getTableOrderTotal: (tableName: string) => number;
  getCurrentItemCount: () => number;

  // Category filter
  setSelectedCategory: (categoryId: number | null) => void;

  // Statistics
  getActiveOrdersCount: () => number;
  getOccupiedTablesCount: () => number;
  getTotalPendingAmount: () => number;
  resetState: () => void;
}

const generateId = () => Math.random().toString(36).substring(2, 9);

const DEFAULT_TABLES: Table[] = [
  { name: 'Стол 1', status: 'empty', capacity: 4 },
  { name: 'Стол 2', status: 'empty', capacity: 4 },
  { name: 'Стол 3', status: 'empty', capacity: 4 },
  { name: 'Стол 4', status: 'empty', capacity: 6 },
  { name: 'Стол 5', status: 'empty', capacity: 6 },
  { name: 'Стол 6', status: 'empty', capacity: 2 },
  { name: 'Стол 7', status: 'empty', capacity: 2 },
  { name: 'Стол 8', status: 'empty', capacity: 8 },
  { name: 'VIP 1', status: 'empty', capacity: 10 },
  { name: 'VIP 2', status: 'empty', capacity: 10 },
  { name: 'Терраса 1', status: 'empty', capacity: 4 },
  { name: 'Терраса 2', status: 'empty', capacity: 4 },
];

const createDefaultRestaurantState = () => ({
  tables: DEFAULT_TABLES,
  activeOrders: {},
  selectedTable: null,
  currentOrderItems: [],
  selectedCategory: null,
});

export const useRestaurantStore = create<RestaurantState>()(
  persist(
    (set, get) => ({
      ...createDefaultRestaurantState(),

      resetState: () => set(createDefaultRestaurantState()),

      initializeTables: () => {
        const state = get();
        if (state.tables.length === 0) {
          set({ tables: DEFAULT_TABLES });
        }
      },

      selectTable: (tableName) => {
        const state = get();
        const existingOrder = state.activeOrders[tableName];

        if (existingOrder) {
          // If table has an active order, load its items for editing/adding
          set({
            selectedTable: tableName,
            currentOrderItems: [...existingOrder.items]
          });
        } else {
          // Fresh order for empty table
          set({
            selectedTable: tableName,
            currentOrderItems: []
          });
        }
      },

      clearSelection: () => set({ selectedTable: null, currentOrderItems: [] }),

      getTableOrder: (tableName) => {
        return get().activeOrders[tableName];
      },

      addItemToOrder: (product) => {
        set((state) => {
          const existingItem = state.currentOrderItems.find(
            (item) => item.product.id === product.id && item.status === 'pending'
          );

          let newItems: OrderItem[];
          if (existingItem) {
            newItems = state.currentOrderItems.map((item) =>
              item.id === existingItem.id
                ? { ...item, quantity: item.quantity + 1 }
                : item
            );
          } else {
            const newItem: OrderItem = {
              id: generateId(),
              product,
              quantity: 1,
              status: 'pending',
              createdAt: new Date().toISOString(),
            };
            newItems = [...state.currentOrderItems, newItem];
          }

          return { currentOrderItems: newItems };
        });
      },

      removeItemFromOrder: (itemId) => {
        set((state) => ({
          currentOrderItems: state.currentOrderItems.filter((item) => item.id !== itemId),
        }));
      },

      updateItemQuantity: (itemId, quantity) => {
        set((state) => ({
          currentOrderItems: state.currentOrderItems.map((item) =>
            item.id === itemId ? { ...item, quantity } : item
          ),
        }));
      },

      setItemNote: (itemId, note) => {
        set((state) => ({
          currentOrderItems: state.currentOrderItems.map((item) =>
            item.id === itemId ? { ...item, note } : item
          ),
        }));
      },

      confirmOrder: (guestCount, notes) => {
        const state = get();
        const { selectedTable, currentOrderItems } = state;

        if (!selectedTable || currentOrderItems.length === 0) {
          throw new Error('No table selected or no items in order');
        }

        const orderId = generateId();
        const now = new Date().toISOString();

        // Mark all items as confirmed
        const confirmedItems = currentOrderItems.map((item) => ({
          ...item,
          status: 'confirmed' as const,
        }));

        const totalAmount = confirmedItems.reduce(
          (sum, item) => sum + Number(item.product.sell_price) * item.quantity,
          0
        );

        const newOrder: TableOrder = {
          id: orderId,
          tableName: selectedTable,
          items: confirmedItems,
          status: 'waiting',
          totalAmount,
          createdAt: now,
          updatedAt: now,
          guestCount,
          notes,
        };

        // Update table status and save order
        set((state) => ({
          tables: state.tables.map((table) =>
            table.name === selectedTable
              ? { ...table, status: 'waiting' as TableStatus, currentOrderId: orderId }
              : table
          ),
          activeOrders: {
            ...state.activeOrders,
            [selectedTable]: newOrder,
          },
          selectedTable: null,
          currentOrderItems: [],
        }));

        return orderId;
      },

      addMoreItems: (tableName) => {
        const state = get();
        const existingOrder = state.activeOrders[tableName];

        if (existingOrder) {
          set({
            selectedTable: tableName,
            currentOrderItems: [...existingOrder.items]
          });
        }
      },

      markItemAsReady: (tableName, itemId) => {
        set((state) => {
          const order = state.activeOrders[tableName];
          if (!order) return state;

          const updatedItems = order.items.map((item) =>
            item.id === itemId ? { ...item, status: 'ready' as const } : item
          );

          return {
            activeOrders: {
              ...state.activeOrders,
              [tableName]: {
                ...order,
                items: updatedItems,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
      },

      markItemAsServed: (tableName, itemId) => {
        set((state) => {
          const order = state.activeOrders[tableName];
          if (!order) return state;

          const updatedItems = order.items.map((item) =>
            item.id === itemId ? { ...item, status: 'served' as const } : item
          );

          // Check if all items are served
          const allServed = updatedItems.every((item) => item.status === 'served');

          return {
            activeOrders: {
              ...state.activeOrders,
              [tableName]: {
                ...order,
                items: updatedItems,
                status: allServed ? 'served' : order.status,
                updatedAt: new Date().toISOString(),
              },
            },
            tables: allServed
              ? state.tables.map((table) =>
                table.name === tableName
                  ? { ...table, status: 'served' as TableStatus }
                  : table
              )
              : state.tables,
          };
        });
      },

      markAllAsServed: (tableName) => {
        set((state) => {
          const order = state.activeOrders[tableName];
          if (!order) return state;

          const updatedItems = order.items.map((item) => ({
            ...item,
            status: 'served' as const,
          }));

          return {
            activeOrders: {
              ...state.activeOrders,
              [tableName]: {
                ...order,
                items: updatedItems,
                status: 'served',
                updatedAt: new Date().toISOString(),
              },
            },
            tables: state.tables.map((table) =>
              table.name === tableName
                ? { ...table, status: 'served' as TableStatus }
                : table
            ),
          };
        });
      },

      requestBill: (tableName) => {
        set((state) => {
          const order = state.activeOrders[tableName];
          if (!order) return state;

          return {
            activeOrders: {
              ...state.activeOrders,
              [tableName]: {
                ...order,
                status: 'paying',
                updatedAt: new Date().toISOString(),
              },
            },
            tables: state.tables.map((table) =>
              table.name === tableName
                ? { ...table, status: 'paying' as TableStatus }
                : table
            ),
          };
        });
      },

      completePayment: (tableName, paymentMethod, cardType) => {
        // Here you would typically make an API call to save the sale
        // For now, we'll just clear the order
        set((state) => {
          const { [tableName]: removedOrder, ...remainingOrders } = state.activeOrders;

          return {
            activeOrders: remainingOrders,
            tables: state.tables.map((table) =>
              table.name === tableName
                ? { ...table, status: 'empty' as TableStatus, currentOrderId: undefined }
                : table
            ),
          };
        });

        // TODO: Save to backend
        console.log(`Payment completed for ${tableName}: ${paymentMethod}${cardType ? ` (${cardType})` : ''}`);
      },

      cancelOrder: (tableName) => {
        set((state) => {
          const { [tableName]: removedOrder, ...remainingOrders } = state.activeOrders;

          return {
            activeOrders: remainingOrders,
            tables: state.tables.map((table) =>
              table.name === tableName
                ? { ...table, status: 'empty' as TableStatus, currentOrderId: undefined }
                : table
            ),
            selectedTable: null,
            currentOrderItems: [],
          };
        });
      },

      getCurrentOrderTotal: () => {
        return get().currentOrderItems.reduce(
          (sum, item) => sum + Number(item.product.sell_price) * item.quantity,
          0
        );
      },

      getTableOrderTotal: (tableName) => {
        const order = get().activeOrders[tableName];
        return order?.totalAmount ?? 0;
      },

      getCurrentItemCount: () => {
        return get().currentOrderItems.reduce((sum, item) => sum + item.quantity, 0);
      },

      setSelectedCategory: (categoryId) => set({ selectedCategory: categoryId }),

      getActiveOrdersCount: () => {
        return Object.keys(get().activeOrders).length;
      },

      getOccupiedTablesCount: () => {
        return get().tables.filter((table) => table.status !== 'empty').length;
      },

      getTotalPendingAmount: () => {
        return Object.values(get().activeOrders).reduce(
          (sum, order) => sum + order.totalAmount,
          0
        );
      },
    }),
    {
      name: RESTAURANT_STORAGE_KEY,
      storage: createCompanyScopedJSONStorage(),
      partialize: (state) => ({
        tables: state.tables,
        activeOrders: state.activeOrders,
        selectedCategory: state.selectedCategory,
      }),
    }
  )
);

if (typeof window !== 'undefined') {
  useAuthStore.subscribe((state, previousState) => {
    const companyId = state.currentCompany?.id ?? null;
    const previousCompanyId = previousState.currentCompany?.id ?? null;

    if (companyId === previousCompanyId) {
      return;
    }

    useRestaurantStore.getState().resetState();
    void useRestaurantStore.persist.rehydrate();
  });
}
