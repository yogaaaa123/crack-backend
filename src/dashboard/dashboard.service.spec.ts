import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma.service';
import { Prisma } from '@prisma/client';

const createMockClient = () => ({
  product: {
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  supplier: {
    count: jest.fn(),
  },
  category: {
    count: jest.fn(),
  },
  salesOrder: {
    aggregate: jest.fn(),
  },
  orderItem: {
    groupBy: jest.fn(),
  },
  $queryRaw: jest.fn(),
});

const mockPrismaService = () => ({
  $queryRaw: jest.fn(),
  getClient: jest.fn(),
});

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: ReturnType<typeof mockPrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DashboardService, { provide: PrismaService, useFactory: mockPrismaService }],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSummary', () => {
    it('should return summary with all metrics', async () => {
      const mockClient = createMockClient();
      mockClient.product.count.mockResolvedValue(100);
      mockClient.supplier.count.mockResolvedValue(5);
      mockClient.category.count.mockResolvedValue(10);
      mockClient.salesOrder.aggregate
        .mockResolvedValueOnce({ _sum: { totalPrice: new Prisma.Decimal('1000'), totalProfit: new Prisma.Decimal('200') } })
        .mockResolvedValueOnce({ _sum: { totalPrice: new Prisma.Decimal('5000'), totalProfit: new Prisma.Decimal('1000') } })
        .mockResolvedValueOnce({ _sum: { totalPrice: new Prisma.Decimal('50000') } });
      mockClient.$queryRaw.mockResolvedValue([{ id: 'p-1', name: 'Low Stock', sku: 'LS-001', stockQuantity: 2, reorderLevel: 10 }]);
      prisma.getClient.mockReturnValue(mockClient);

      const result = await service.getSummary('t-1');
      expect(result.totalProducts).toBe(100);
      expect(result.totalSuppliers).toBe(5);
      expect(result.today.revenue.toString()).toBe('1000');
      expect(result.thisMonth.revenue.toString()).toBe('5000');
      expect(result.lowStockProducts).toHaveLength(1);
    });
  });

  describe('getTopProducts', () => {
    it('should return top products by sales quantity', async () => {
      const mockClient = createMockClient();
      mockClient.orderItem.groupBy.mockResolvedValue([
        { productId: 'p-1', _sum: { quantity: 50 } },
        { productId: 'p-2', _sum: { quantity: 30 } },
      ]);
      prisma.getClient.mockReturnValue(mockClient);

      const result = await service.getTopProducts('t-1', 10);
      expect(result).toHaveLength(2);
      expect(result[0].productId).toBe('p-1');
    });
  });

  describe('getSalesTrend', () => {
    it('should return daily sales trend', async () => {
      const mockClient = createMockClient();
      mockClient.$queryRaw.mockResolvedValue([
        { date: new Date('2026-05-01'), revenue: new Prisma.Decimal('500'), profit: new Prisma.Decimal('100'), order_count: BigInt(5) },
      ]);
      prisma.getClient.mockReturnValue(mockClient);

      const result = await service.getSalesTrend('t-1', 30);
      expect(result).toHaveLength(1);
      expect(result[0].order_count).toBe(5);
      // Service maps and converts to totalRevenue
      expect(result[0].totalRevenue).toBe(500);
      expect(result[0].totalProfit).toBe(100);
      expect(result[0].totalSales).toBe(5);
    });
  });

  describe('getInventoryValue', () => {
    it('should return total stock items', async () => {
      const mockClient = createMockClient();
      mockClient.product.aggregate.mockResolvedValue({ _sum: { stockQuantity: 500 } });
      prisma.getClient.mockReturnValue(mockClient);

      const result = await service.getInventoryValue('t-1');
      expect(result.totalStockItems).toBe(500);
    });
  });
});
