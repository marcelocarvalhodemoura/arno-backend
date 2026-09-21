import { Test } from '@nestjs/testing';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

describe('CatalogController', () => {
  const catalog = {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
    listMovementTypes: jest.fn(),
    createMovementType: jest.fn(),
    updateMovementType: jest.fn(),
    listFees: jest.fn(),
    createFee: jest.fn(),
    updateFee: jest.fn(),
    deleteFee: jest.fn(),
    meta: jest.fn(),
  };
  let controller: CatalogController;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [{ provide: CatalogService, useValue: catalog }],
    }).compile();
    controller = moduleRef.get(CatalogController);
  });

  it('delegates catalog endpoints', async () => {
    catalog.getSettings.mockResolvedValue({ groupName: 'Arno' });
    catalog.meta.mockReturnValue({ branches: [] });
    catalog.deleteFee.mockResolvedValue(undefined);
    const auth = {
      user: 't',
      userId: '1',
      role: 'tesoureiro' as const,
      exp: 1,
    };

    await expect(controller.getSettings()).resolves.toEqual({
      groupName: 'Arno',
    });
    expect(controller.meta()).toEqual({ branches: [] });
    await expect(controller.deleteFee('fee-1')).resolves.toBeUndefined();
    expect(catalog.deleteFee).toHaveBeenCalledWith('fee-1');
    await controller.updateSettings({ mensalidadeDueDay: 10 }, auth);
    expect(catalog.updateSettings).toHaveBeenCalledWith({ mensalidadeDueDay: 10 }, auth);
  });
});
