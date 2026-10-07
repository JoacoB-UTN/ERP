import type { FiscalSource } from '@erp/shared';
import { readArcaRecipient, readFiscalRecipient } from './fiscal-recipient';

const cuit = '20123456786';
const dniRequest = {
  recipientDocumentType: 96,
  recipientDocumentNumber: '0012345678',
  recipientVatConditionId: 5,
  voucherType: 6,
};
const saved: FiscalSource['recipient'] = {
  legalName: 'Receptor',
  taxId: '20-12345678-6',
  taxCondition: 'RESPONSABLE_INSCRIPTO',
};

describe('saved fiscal recipient identity', () => {
  it('reads historical CUIT-only and explicit CUIT as the same identity', () => {
    const identity = {
      recipientDocumentType: 80,
      recipientDocumentNumber: cuit,
    };
    expect(readArcaRecipient({ recipientCuit: cuit })).toEqual(identity);
    expect(readArcaRecipient(identity)).toEqual(identity);
    expect(readFiscalRecipient(saved, 1)).toEqual(identity);
    expect(readFiscalRecipient({ ...saved, documentType: 'CUIT' }, 1)).toEqual(
      identity,
    );
  });
  it.each([6, 8])(
    'normalizes DNI for B voucher %s without changing the input',
    (voucherType) => {
      const request = { ...dniRequest, voucherType };
      const before = JSON.stringify(request);
      expect(readArcaRecipient(request)).toEqual({
        recipientDocumentType: 96,
        recipientDocumentNumber: '12345678',
      });
      expect(JSON.stringify(request)).toBe(before);
    },
  );
  it.each(['1', '00000000001', '99999999999'])(
    'accepts positive DNI %s without an arbitrary minimum length',
    (recipientDocumentNumber) => {
      expect(
        readArcaRecipient({ ...dniRequest, recipientDocumentNumber })
          .recipientDocumentNumber,
      ).toBe(recipientDocumentNumber.replace(/^0+/, ''));
    },
  );
  it.each([
    '',
    '0',
    '00000000000',
    '123456789012',
    '-1',
    '+1',
    '1.0',
    '1e4',
    '12.345.678',
    '12-345',
    ' 123',
    '123 ',
    '１２３',
    'secret-token',
  ])('rejects malformed DNI %s', (recipientDocumentNumber) => {
    expect(() =>
      readArcaRecipient({ ...dniRequest, recipientDocumentNumber }),
    ).toThrow('documento');
  });
  it.each([1, 3, 11, 13, 0, '6', undefined])(
    'rejects DNI on unsupported voucher %s',
    (voucherType) => {
      expect(() => readArcaRecipient({ ...dniRequest, voucherType })).toThrow();
    },
  );
  it.each([1, 4, 6, 0, '5', null, undefined])(
    'requires declared CF id5, not %s',
    (recipientVatConditionId) => {
      expect(() =>
        readArcaRecipient({ ...dniRequest, recipientVatConditionId }),
      ).toThrow();
    },
  );
  it.each([
    null,
    [],
    {},
    {
      recipientCuit: cuit,
      recipientDocumentType: 80,
      recipientDocumentNumber: cuit,
    },
    { recipientCuit: cuit, recipientDocumentType: undefined },
    { recipientCuit: cuit, recipientDocumentNumber: cuit },
    { recipientDocumentType: 80 },
    { recipientDocumentNumber: cuit },
    { recipientCuit: null },
    { recipientCuit: '20-12345678-6' },
    { recipientCuit: '20123456780' },
    { recipientDocumentType: 80, recipientDocumentNumber: 20123456786 },
    { recipientDocumentType: 80, recipientDocumentNumber: '20123456780' },
    { recipientDocumentType: '80', recipientDocumentNumber: cuit },
    { ...dniRequest, recipientCuit: cuit },
    { ...dniRequest, recipientDocumentNumber: 12345678 },
    { ...dniRequest, recipientDocumentType: 99 },
  ])(
    'rejects ambiguous, partial or unsupported stored request %#',
    (request) => {
      expect(() => readArcaRecipient(request)).toThrow();
    },
  );
  it('requires explicit saved DNI and CF, never inferring from a number', () => {
    const recipient: FiscalSource['recipient'] = {
      legalName: 'Consumidor',
      taxId: '0012345678',
      taxCondition: 'CONSUMIDOR_FINAL',
    };
    expect(() => readFiscalRecipient(recipient, 6)).toThrow();
    expect(() =>
      readFiscalRecipient({ ...recipient, documentType: null }, 6),
    ).toThrow();
    expect(() =>
      readFiscalRecipient({ ...recipient, documentType: 'OTHER' }, 6),
    ).toThrow();
    expect(
      readFiscalRecipient({ ...recipient, documentType: 'DNI' }, 6),
    ).toEqual({
      recipientDocumentType: 96,
      recipientDocumentNumber: '12345678',
    });
    expect(() =>
      readFiscalRecipient(
        { ...recipient, documentType: 'DNI', taxCondition: 'UNKNOWN' },
        6,
      ),
    ).toThrow();
    expect(() =>
      readFiscalRecipient(
        { ...recipient, documentType: 'DNI', taxCondition: 'EXENTO' },
        6,
      ),
    ).toThrow();
  });
  it('keeps a same-number CUIT and DNI distinct', () => {
    const recipient = {
      ...saved,
      taxId: cuit,
      taxCondition: 'CONSUMIDOR_FINAL',
    };
    expect(readFiscalRecipient(recipient, 6).recipientDocumentType).toBe(80);
    expect(
      readFiscalRecipient({ ...recipient, documentType: 'DNI' }, 6)
        .recipientDocumentType,
    ).toBe(96);
  });
});
