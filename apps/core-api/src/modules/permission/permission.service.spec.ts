import { Test, TestingModule } from '@nestjs/testing';
import { PermissionService } from './permission.service';
import { ForbiddenException } from '@nestjs/common';

describe('PermissionService', () => {
  let service: PermissionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PermissionService],
    }).compile();
    service = module.get<PermissionService>(PermissionService);
  });

  describe('canAccess', () => {
    it('should allow wildcard permission', () => {
      expect(service.canAccess(['*'], 'object', 'read')).toBe(true);
    });

    it('should allow exact match', () => {
      expect(service.canAccess(['object.read'], 'object', 'read')).toBe(true);
    });

    it('should allow resource wildcard', () => {
      expect(service.canAccess(['object.*'], 'object', 'read')).toBe(true);
    });

    it('should deny when no matching permission', () => {
      expect(service.canAccess(['object.read'], 'object', 'write')).toBe(false);
    });

    it('should deny empty permissions', () => {
      expect(service.canAccess([], 'object', 'read')).toBe(false);
    });
  });

  describe('assertCanAccess', () => {
    it('should not throw when permitted', () => {
      expect(() => service.assertCanAccess(['*'], 'object', 'read')).not.toThrow();
    });

    it('should throw ForbiddenException when denied', () => {
      expect(() => service.assertCanAccess([], 'object', 'read')).toThrow(ForbiddenException);
    });
  });

  describe('getAllowedFields', () => {
    it('should return null for wildcard permission', () => {
      expect(service.getAllowedFields(['*'], 'object', 'read')).toBeNull();
    });

    it('should return null when no field restrictions', () => {
      expect(service.getAllowedFields(['object.read'], 'object', 'read')).toBeNull();
    });

    it('should return field set when restrictions exist', () => {
      const result = service.getAllowedFields(['object.read:name,phone'], 'object', 'read');
      expect(result).toEqual(new Set(['name', 'phone']));
    });

    it('should merge fields from multiple permissions', () => {
      const result = service.getAllowedFields(['object.read:name', 'object.read:phone'], 'object', 'read');
      expect(result).toEqual(new Set(['name', 'phone']));
    });

    it('should ignore fields from non-matching resource', () => {
      const result = service.getAllowedFields(['user.write:name', 'object.read:phone'], 'object', 'read');
      expect(result).toEqual(new Set(['phone']));
    });

    it('should ignore fields from non-matching action', () => {
      const result = service.getAllowedFields(['object.write:name', 'object.read:phone'], 'object', 'read');
      expect(result).toEqual(new Set(['phone']));
    });
  });

  describe('filterFields', () => {
    it('should return all properties when allowedFields is null', () => {
      const props = { name: 'Test', phone: '123', secret: 'hidden' };
      const result = service.filterFields(props, null);
      expect(result).toEqual(props);
    });

    it('should filter fields when allowedFields is provided', () => {
      const props = { name: 'Test', phone: '123', secret: 'hidden' };
      const result = service.filterFields(props, new Set(['name', 'phone']));
      expect(result).toEqual({ name: 'Test', phone: '123' });
    });
  });
});
