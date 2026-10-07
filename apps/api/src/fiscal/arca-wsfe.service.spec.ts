import { ArcaWsfeService } from './arca-wsfe.service';
import { ArcaWsaaService } from './arca-wsaa.service';
import { parseXml, soapRequest } from './arca-soap';
import type {
  ArcaCreditNoteRequest,
  ArcaInvoiceRequest,
} from './fiscal-request';
jest.mock('./arca-soap', () => ({
  ...jest.requireActual<typeof import('./arca-soap')>('./arca-soap'),
  soapRequest: jest.fn(),
}));
const request: ArcaInvoiceRequest = {
  issuerCuit: '20123456786',
  pointOfSale: 1,
  voucherType: 1,
  voucherNumber: 4,
  date: '20261004',
  recipientCuit: '20123456786',
  recipientVatConditionId: 1,
  total: '121.00',
  net: '100.00',
  vat: '21.00',
  exempt: '0.00',
  notTaxed: '0.00',
  iva: [{ id: 5, base: '100.00', amount: '21.00' }],
};
const detail =
  '<Concepto>1</Concepto><DocTipo>80</DocTipo><DocNro>20123456786</DocNro><CbteDesde>4</CbteDesde><CbteHasta>4</CbteHasta><CbteFch>20261004</CbteFch>';
const authorized = `<FeCabResp><Cuit>20123456786</Cuit><PtoVta>1</PtoVta><CbteTipo>1</CbteTipo><CantReg>1</CantReg><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse>${detail}<Resultado>A</Resultado><CAE>12345678901234</CAE><CAEFchVto>20261014</CAEFchVto></FECAEDetResponse></FeDetResp>`;
const consulted = `<ResultGet>${detail}<PtoVta>1</PtoVta><CbteTipo>1</CbteTipo><Resultado>A</Resultado><EmisionTipo>CAE</EmisionTipo><MonId>PES</MonId><MonCotiz>1.000000</MonCotiz><CondicionIVAReceptorId>1</CondicionIVAReceptorId><ImpTotal>121</ImpTotal><ImpTotConc>0</ImpTotConc><ImpNeto>100</ImpNeto><ImpOpEx>0</ImpOpEx><ImpTrib>0</ImpTrib><ImpIVA>21</ImpIVA><Iva><AlicIva><Id>5</Id><BaseImp>100</BaseImp><Importe>21</Importe></AlicIva></Iva><CodAutorizacion>12345678901234</CodAutorizacion><FchVto>20261014</FchVto></ResultGet>`;
const answer = (method: string, xml: string) =>
  parseXml(
    `<Body><${method}Response xmlns="http://ar.gov.afip.dif.FEV1/"><${method}Result>${xml}</${method}Result></${method}Response></Body>`,
  );
const rejected = (observations = '', type = 1) =>
  authorized
    .replace('<CbteTipo>1</CbteTipo>', `<CbteTipo>${type}</CbteTipo>`)
    .replaceAll('<Resultado>A</Resultado>', '<Resultado>R</Resultado>')
    .replace(
      '<CAE>12345678901234</CAE><CAEFchVto>20261014</CAEFchVto>',
      observations,
    );
const genericRejection =
  'ARCA rechazó el comprobante de homologación. Revisá los datos fiscales.';
const send = jest.mocked(soapRequest);
let service: ArcaWsfeService;
beforeEach(() => {
  jest.clearAllMocks();
  service = new ArcaWsfeService({
    getTicket: jest.fn().mockResolvedValue({
      token: 'token<&',
      sign: 'secret-sign',
      expiresAt: new Date(),
    }),
  } as unknown as ArcaWsaaService);
});
describe('WSFE homologation protocol', () => {
  it('sends exactly one request with escaped credentials and returns verified CAE', async () => {
    send.mockResolvedValue(answer('FECAESolicitar', authorized));
    expect(await service.authorize('company', request)).toMatchObject({
      status: 'AUTHORIZED',
      cae: '12345678901234',
      expiresAt: '20261014',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][2]).toContain('<Token>token&lt;&amp;</Token>');
    expect(send.mock.calls[0][2]).toContain(
      '<CondicionIVAReceptorId>1</CondicionIVAReceptorId>',
    );
    expect(send.mock.calls[0][2]).toContain('<ImpNeto>100.00</ImpNeto>');
  });
  it('accepts only an explicit correlated rejection and never exposes upstream messages', async () => {
    send.mockResolvedValue(
      answer(
        'FECAESolicitar',
        authorized
          .replaceAll('<Resultado>A</Resultado>', '<Resultado>R</Resultado>')
          .replace(
            '<CAE>12345678901234</CAE><CAEFchVto>20261014</CAEFchVto>',
            '<Observaciones><Obs><Code>100</Code><Msg>secret-sign</Msg></Obs></Observaciones>',
          ),
      ),
    );
    const result = await service.authorize('company', request);
    expect(result.status).toBe('REJECTED');
    expect(result.message).not.toContain('secret-sign');
  });
  it.each([
    ['Cuit', '20123456786', '20123456787'],
    ['PtoVta', '1', '2'],
    ['CbteTipo', '1', '6'],
    ['CantReg', '1', '2'],
    ['DocTipo', '80', '99'],
    ['DocNro', '20123456786', '20123456787'],
    ['CbteDesde', '4', '5'],
    ['CbteFch', '20261004', '20261005'],
    ['CAE', '12345678901234', '123'],
    ['CAEFchVto', '20261014', '20260230'],
  ])('keeps mismatched %s uncertain', async (field, before, after) => {
    send.mockResolvedValue(
      answer(
        'FECAESolicitar',
        authorized.replace(
          `<${field}>${before}</${field}>`,
          `<${field}>${after}</${field}>`,
        ),
      ),
    );
    await expect(service.authorize('company', request)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not treat top-level errors as a definitive rejection', async () => {
    send.mockResolvedValue(
      answer(
        'FECAESolicitar',
        '<Errors><Err><Code>500</Code><Msg>secret</Msg></Err></Errors>',
      ),
    );
    await expect(service.authorize('company', request)).rejects.toThrow(
      'No se pudo verificar',
    );
  });
  it('never retries ambiguous transport failures or exposes secrets', async () => {
    send.mockRejectedValue(new Error('secret-sign'));
    await expect(service.authorize('company', request)).rejects.toThrow(
      'No se pudo verificar',
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('reconciles an exact authorized invoice, accepting equivalent decimal formatting', async () => {
    send.mockResolvedValue(answer('FECompConsultar', consulted));
    expect(await service.consult('company', request)).toMatchObject({
      status: 'AUTHORIZED',
      cae: '12345678901234',
    });
  });
  it.each([
    ['ImpTotal', '121', '122'],
    ['ImpTrib', '0', '1'],
    ['ImpNeto', '100', '99'],
    ['ImpIVA', '21', '22'],
    ['MonId', 'PES', 'DOL'],
    ['MonCotiz', '1.000000', '2'],
    ['CondicionIVAReceptorId', '1', '6'],
    ['EmisionTipo', 'CAE', 'CAEA'],
    ['BaseImp', '100', '101'],
    ['Importe', '21', '22'],
    ['Id', '5', '4'],
  ])('rejects consultation collision in %s', async (field, before, after) => {
    send.mockResolvedValue(
      answer(
        'FECompConsultar',
        consulted.replace(
          `<${field}>${before}</${field}>`,
          `<${field}>${after}</${field}>`,
        ),
      ),
    );
    await expect(service.consult('company', request)).rejects.toThrow();
  });
  it('rejects duplicate VAT rows and missing receiver condition', async () => {
    send.mockResolvedValue(
      answer(
        'FECompConsultar',
        consulted.replace(
          '</Iva>',
          '<AlicIva><Id>5</Id><BaseImp>100</BaseImp><Importe>21</Importe></AlicIva></Iva>',
        ),
      ),
    );
    await expect(service.consult('company', request)).rejects.toThrow();
    send.mockResolvedValue(
      answer(
        'FECompConsultar',
        consulted.replace(
          '<CondicionIVAReceptorId>1</CondicionIVAReceptorId>',
          '',
        ),
      ),
    );
    await expect(service.consult('company', request)).rejects.toThrow();
  });
  it('returns not-found only for sole official 602 with no invoice', async () => {
    const error =
      '<Errors><Err><Code>602</Code><Msg>No existen datos</Msg></Err></Errors>';
    send.mockResolvedValue(answer('FECompConsultar', error));
    expect(await service.consult('company', request)).toBeNull();
    send.mockResolvedValue(answer('FECompConsultar', error + consulted));
    await expect(service.consult('company', request)).rejects.toThrow();
    send.mockResolvedValue(
      answer('FECompConsultar', error.replace('602', '500')),
    );
    await expect(service.consult('company', request)).rejects.toThrow();
  });
  it('verifies series identity and bounds the last number', async () => {
    send.mockResolvedValue(
      answer(
        'FECompUltimoAutorizado',
        '<PtoVta>1</PtoVta><CbteTipo>1</CbteTipo><CbteNro>3</CbteNro>',
      ),
    );
    expect(await service.lastNumber('company', request.issuerCuit, 1, 1)).toBe(
      3,
    );
    await expect(
      service.lastNumber('company', request.issuerCuit, 2, 1),
    ).rejects.toThrow();
  });
  it('validates active CAE point of sale, class-specific receiver catalog and VAT date', async () => {
    send
      .mockResolvedValueOnce(
        answer(
          'FEParamGetPtosVenta',
          '<ResultGet><PtoVenta><Nro>1</Nro><EmisionTipo>CAE</EmisionTipo><Bloqueado>N</Bloqueado><FchBaja>NULL</FchBaja></PtoVenta></ResultGet>',
        ),
      )
      .mockResolvedValueOnce(
        answer(
          'FEParamGetCondicionIvaReceptor',
          '<ResultGet><CondicionIvaReceptor><Id>1</Id><Cmp_Clase>A</Cmp_Clase></CondicionIvaReceptor></ResultGet>',
        ),
      )
      .mockResolvedValueOnce(
        answer(
          'FEParamGetTiposIva',
          '<ResultGet><IvaTipo><Id>5</Id><FchDesde>20090101</FchDesde><FchHasta>NULL</FchHasta></IvaTipo></ResultGet>',
        ),
      );
    await expect(service.validate('company', request)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(3);
  });
  it.each([
    '<Bloqueado>S</Bloqueado>',
    '<EmisionTipo>CAEA</EmisionTipo>',
    '<FchBaja>20200101</FchBaja>',
  ])('blocks invalid point-of-sale state %s', async (field) => {
    let xml =
      '<ResultGet><PtoVenta><Nro>1</Nro><EmisionTipo>CAE</EmisionTipo><Bloqueado>N</Bloqueado><FchBaja></FchBaja></PtoVenta></ResultGet>';
    const name = field.match(/^<([^>]+)>/)![1];
    xml = xml.replace(new RegExp(`<${name}>.*?</${name}>`), field);
    send.mockResolvedValue(answer('FEParamGetPtosVenta', xml));
    await expect(service.validate('company', request)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(['A/M/C', 'A/ALEY/C'])(
    'accepts canonical combined classes %s',
    async (classes) => {
      send
        .mockResolvedValueOnce(
          answer(
            'FEParamGetPtosVenta',
            '<ResultGet><PtoVenta><Nro>1</Nro><EmisionTipo>CAE</EmisionTipo><Bloqueado>N</Bloqueado></PtoVenta></ResultGet>',
          ),
        )
        .mockResolvedValueOnce(
          answer(
            'FEParamGetCondicionIvaReceptor',
            `<ResultGet><CondicionIvaReceptor><Id>1</Id><Cmp_Clase>${classes}</Cmp_Clase></CondicionIvaReceptor></ResultGet>`,
          ),
        )
        .mockResolvedValueOnce(
          answer(
            'FEParamGetTiposIva',
            '<ResultGet><IvaTipo><Id>5</Id><FchDesde>20090101</FchDesde></IvaTipo></ResultGet>',
          ),
        );
      await expect(
        service.validate('company', request),
      ).resolves.toBeUndefined();
    },
  );
  it.each(['B/C', 'UNKNOWN/A', 'A/A', 'ALEY'])(
    'rejects incompatible or malformed classes %s',
    async (classes) => {
      send
        .mockResolvedValueOnce(
          answer(
            'FEParamGetPtosVenta',
            '<ResultGet><PtoVenta><Nro>1</Nro><EmisionTipo>CAE</EmisionTipo><Bloqueado>N</Bloqueado></PtoVenta></ResultGet>',
          ),
        )
        .mockResolvedValueOnce(
          answer(
            'FEParamGetCondicionIvaReceptor',
            `<ResultGet><CondicionIvaReceptor><Id>1</Id><Cmp_Clase>${classes}</Cmp_Clase></CondicionIvaReceptor></ResultGet>`,
          ),
        );
      await expect(service.validate('company', request)).rejects.toThrow();
    },
  );
  it.each(['<FchDesde>20270101</FchDesde>', '<FchHasta>20260101</FchHasta>'])(
    'rejects an inactive VAT catalog entry %s',
    async (range) => {
      send
        .mockResolvedValueOnce(
          answer(
            'FEParamGetPtosVenta',
            '<ResultGet><PtoVenta><Nro>1</Nro><EmisionTipo>CAE</EmisionTipo><Bloqueado>N</Bloqueado></PtoVenta></ResultGet>',
          ),
        )
        .mockResolvedValueOnce(
          answer(
            'FEParamGetCondicionIvaReceptor',
            '<ResultGet><CondicionIvaReceptor><Id>1</Id><Cmp_Clase>A/C</Cmp_Clase></CondicionIvaReceptor></ResultGet>',
          ),
        )
        .mockResolvedValueOnce(
          answer(
            'FEParamGetTiposIva',
            `<ResultGet><IvaTipo><Id>5</Id>${range.startsWith('<FchHasta>') ? '<FchDesde>20090101</FchDesde>' : ''}${range}</IvaTipo></ResultGet>`,
          ),
        );
      await expect(service.validate('company', request)).rejects.toThrow();
    },
  );
  it('rejects duplicate result fields and incorrect namespaces', async () => {
    send.mockResolvedValue(
      answer(
        'FECAESolicitar',
        authorized.replace('<CAE>', '<CAE>12345678901234</CAE><CAE>'),
      ),
    );
    await expect(service.authorize('company', request)).rejects.toThrow();
    send.mockResolvedValue(
      answer(
        'FECAESolicitar',
        authorized.replace('<CAE>', '<CAE xmlns="urn:wrong">'),
      ),
    );
    await expect(service.authorize('company', request)).rejects.toThrow();
  });
  it('rejects reconciliation with extra tax and non-product fields', async () => {
    for (const extra of [
      '<Tributos><Tributo><Id>1</Id></Tributo></Tributos>',
      '<FchServDesde>20261001</FchServDesde>',
    ]) {
      send.mockResolvedValue(
        answer(
          'FECompConsultar',
          consulted.replace('</ResultGet>', extra + '</ResultGet>'),
        ),
      );
      await expect(service.consult('company', request)).rejects.toThrow();
    }
  });
});

describe('safe diagnostics for correlated WSFE rejections', () => {
  it.each([
    ['10048', 'El total no coincide con la suma de sus componentes.'],
    [
      '10242',
      'Revisá la condición de IVA del receptor en el catálogo de ARCA.',
    ],
    [
      '10243',
      'La condición de IVA del receptor no corresponde a la clase del comprobante.',
    ],
    ['10246', 'Falta informar la condición de IVA del receptor.'],
    ['1', 'Revisá este código en el manual de ARCA.'],
    ['99999', 'Revisá este código en el manual de ARCA.'],
  ])('uses only the local description for code %s', async (code, hint) => {
    send.mockResolvedValue(
      answer(
        'FECAESolicitar',
        rejected(
          `<Observaciones><Obs><Code>${code}</Code><Msg>secret-sign token&lt;&amp; upstream advice</Msg></Obs></Observaciones>`,
        ),
      ),
    );
    expect(await service.authorize('company', request)).toEqual({
      status: 'REJECTED',
      cae: null,
      expiresAt: null,
      message: `${genericRejection} Código ${code}: ${hint}`,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('deduplicates valid codes in response order and ignores malformed siblings', async () => {
    send.mockResolvedValue(
      answer(
        'FECAESolicitar',
        rejected(
          '<Observaciones>' +
            ['10246', 'secret-sign', '10048', '10246', ' 99999 ', '10048']
              .map((code) => `<Obs><Code>${code}</Code></Obs>`)
              .join('') +
            '</Observaciones>',
        ),
      ),
    );
    const result = await service.authorize('company', request);
    expect(result.status).toBe('REJECTED');
    expect(result.message.match(/Código \d+/g)).toEqual([
      'Código 10246',
      'Código 10048',
      'Código 99999',
    ]);
    expect(result.message).not.toContain('secret-sign');
  });

  it.each([
    '',
    '0',
    '-1',
    '+1',
    '00123',
    '1.0',
    '1e4',
    '0x10',
    '100000',
    '999999999999999999999999',
    '10 242',
    '１０２４２',
    '10242 secret-sign',
    '&lt;Token&gt;secret-sign&lt;/Token&gt;',
  ])(
    'keeps rejection with a safe fallback for malformed code %s',
    async (code) => {
      send.mockResolvedValue(
        answer(
          'FECAESolicitar',
          rejected(
            `<Observaciones><Obs><Code>${code}</Code></Obs></Observaciones>`,
          ),
        ),
      );
      expect(await service.authorize('company', request)).toEqual({
        status: 'REJECTED',
        cae: null,
        expiresAt: null,
        message: genericRejection,
      });
    },
  );

  it.each([
    '',
    '<Observaciones/>',
    '<Observaciones><Obs><Msg>secret-sign 10242</Msg></Obs></Observaciones>',
    '<Observaciones><Obs><Code/></Obs></Observaciones>',
    '<Observaciones><Obs><Code>10242</Code><Code>10242</Code></Obs></Observaciones>',
    '<Observaciones><Obs><Code>10242</Code><Code>10243</Code></Obs></Observaciones>',
    '<Observaciones><Obs><Code><Code>10242</Code></Code></Obs></Observaciones>',
    '<Observaciones><Obs><Nested><Code>10242</Code></Nested></Obs></Observaciones>',
    '<Observaciones><Nested><Obs><Code>10242</Code></Obs></Nested></Observaciones>',
    '<Nested><Observaciones><Obs><Code>10242</Code></Obs></Observaciones></Nested>',
    '<Observaciones><Obs><Code>10242</Code></Obs></Observaciones><Observaciones/>',
    '<Observaciones>text<Obs><Code>10242</Code></Obs></Observaciones>',
    '<Observaciones><Obs>text<Code>10242</Code></Obs></Observaciones>',
  ])(
    'never searches descendants or throws for malformed diagnostics %#',
    async (xml) => {
      send.mockResolvedValue(answer('FECAESolicitar', rejected(xml)));
      await expect(service.authorize('company', request)).resolves.toEqual({
        status: 'REJECTED',
        cae: null,
        expiresAt: null,
        message: genericRejection,
      });
    },
  );

  it('does not read observation codes from the header or top-level result', async () => {
    const observations =
      '<Observaciones><Obs><Code>10242</Code></Obs></Observaciones>';
    send.mockResolvedValue(
      answer(
        'FECAESolicitar',
        rejected().replace('</FeCabResp>', `${observations}</FeCabResp>`) +
          observations,
      ),
    );
    await expect(service.authorize('company', request)).resolves.toMatchObject({
      status: 'REJECTED',
      message: genericRejection,
    });
  });

  it('bounds the message to ten distinct codes', async () => {
    send.mockResolvedValue(
      answer(
        'FECAESolicitar',
        rejected(
          '<Observaciones>' +
            Array.from(
              { length: 20 },
              (_, i) => `<Obs><Code>${50000 + i}</Code></Obs>`,
            ).join('') +
            '</Observaciones>',
        ),
      ),
    );
    const result = await service.authorize('company', request);
    expect(result.message.match(/Código \d+/g)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Código ${50000 + i}`),
    );
    expect(result.message.length).toBeLessThan(1000);
  });

  it.each([
    `<Observaciones>${'<Obs><Msg>secret-sign</Msg></Obs>'.repeat(100)}<Obs><Code>10242</Code></Obs></Observaciones>`,
    `<Observaciones><Obs>${'<Msg>secret-sign</Msg>'.repeat(100)}<Code>10242</Code></Obs></Observaciones>`,
    `${'<Other/>'.repeat(100)}<Observaciones><Obs><Code>10242</Code></Obs></Observaciones>`,
  ])(
    'bounds scanning even when no usable code has been found %#',
    async (xml) => {
      send.mockResolvedValue(answer('FECAESolicitar', rejected(xml)));
      await expect(
        service.authorize('company', request),
      ).resolves.toMatchObject({
        status: 'REJECTED',
        message: genericRejection,
      });
    },
  );

  it.each(['Observaciones', 'Obs', 'Code', 'Msg'])(
    'preserves uncertainty for an unexpected namespace on %s',
    async (field) => {
      const observations =
        '<Observaciones><Obs><Code>10242</Code><Msg>secret-sign</Msg></Obs></Observaciones>';
      send.mockResolvedValue(
        answer(
          'FECAESolicitar',
          rejected(
            observations.replace(`<${field}>`, `<${field} xmlns="urn:wrong">`),
          ),
        ),
      );
      await expect(service.authorize('company', request)).rejects.toThrow(
        'No se pudo verificar',
      );
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['Cuit', '20123456786', '20123456787'],
    ['PtoVta', '1', '2'],
    ['CbteTipo', '1', '6'],
    ['CantReg', '1', '2'],
    ['DocTipo', '80', '99'],
    ['DocNro', '20123456786', '20123456787'],
    ['CbteDesde', '4', '5'],
    ['CbteFch', '20261004', '20261005'],
    ['Resultado', 'R', 'A'],
  ])(
    'never uses diagnostics to resolve a mismatched %s',
    async (field, before, after) => {
      send.mockResolvedValue(
        answer(
          'FECAESolicitar',
          rejected(
            '<Observaciones><Obs><Code>10242</Code></Obs></Observaciones>',
          ).replace(
            `<${field}>${before}</${field}>`,
            `<${field}>${after}</${field}>`,
          ),
        ),
      );
      await expect(service.authorize('company', request)).rejects.toThrow();
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    '<CAE>12345678901234</CAE>',
    '<CAEFchVto>20261014</CAEFchVto>',
    '<CAE/><CAE/>',
  ])(
    'preserves uncertainty when rejection also contains authorization data %#',
    async (xml) => {
      send.mockResolvedValue(
        answer(
          'FECAESolicitar',
          rejected(
            `${xml}<Observaciones><Obs><Code>10242</Code></Obs></Observaciones>`,
          ),
        ),
      );
      await expect(service.authorize('company', request)).rejects.toThrow();
    },
  );

  it('keeps top-level errors uncertain even with a correlated R and valid observation', async () => {
    send.mockResolvedValue(
      answer(
        'FECAESolicitar',
        rejected(
          '<Observaciones><Obs><Code>10242</Code></Obs></Observaciones>',
        ) +
          '<Errors><Err><Code>500</Code><Msg>secret-sign</Msg></Err></Errors>',
      ),
    );
    await expect(service.authorize('company', request)).rejects.toThrow(
      'No se pudo verificar',
    );
  });

  it('does not attach rejection diagnostics to authorized results', async () => {
    send.mockResolvedValue(
      answer(
        'FECAESolicitar',
        authorized.replace(
          '</FECAEDetResponse>',
          '<Observaciones><Obs><Code>10242</Code><Msg>secret-sign</Msg></Obs></Observaciones></FECAEDetResponse>',
        ),
      ),
    );
    await expect(service.authorize('company', request)).resolves.toEqual({
      status: 'AUTHORIZED',
      cae: '12345678901234',
      expiresAt: '20261014',
      message: 'Comprobante autorizado en homologación. Sin validez fiscal.',
    });
  });

  it.each([3, 8, 13] as const)(
    'uses the same safe diagnostics for a rejected NC %s',
    async (type) => {
      send.mockResolvedValue(
        answer(
          'FECAESolicitar',
          rejected(
            '<Observaciones><Obs><Code>10243</Code><Msg>secret-sign</Msg></Obs></Observaciones>',
            type,
          ),
        ),
      );
      await expect(
        service.authorize('company', creditRequest(type)),
      ).resolves.toEqual({
        status: 'REJECTED',
        cae: null,
        expiresAt: null,
        message: `${genericRejection} Código 10243: La condición de IVA del receptor no corresponde a la clase del comprobante.`,
      });
      expect(send.mock.calls[0][2]).toContain(associationXml(type));
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
});

function creditRequest(type: 3 | 8 | 13 = 3): ArcaCreditNoteRequest {
  return {
    ...request,
    voucherType: type,
    recipientVatConditionId: type === 8 ? 5 : 1,
    ...(type === 13 ? { net: '121.00', vat: '0.00', iva: [] } : {}),
    associated: {
      voucherType: ({ 3: 1, 8: 6, 13: 11 } as const)[type],
      pointOfSale: 1,
      voucherNumber: 9,
      issuerCuit: request.issuerCuit,
      date: '20261003',
    },
  };
}
function associationXml(type: 3 | 8 | 13 = 3): string {
  return `<CbtesAsoc><CbteAsoc><Tipo>${creditRequest(type).associated.voucherType}</Tipo><PtoVta>1</PtoVta><Nro>9</Nro><Cuit>20123456786</Cuit><CbteFch>20261003</CbteFch></CbteAsoc></CbtesAsoc>`;
}
function creditConsulted(type: 3 | 8 | 13 = 3): string {
  let result = consulted
    .replace('<CbteTipo>1</CbteTipo>', `<CbteTipo>${type}</CbteTipo>`)
    .replace('</ResultGet>', `${associationXml(type)}</ResultGet>`);
  if (type === 8)
    result = result.replace(
      '<CondicionIVAReceptorId>1</CondicionIVAReceptorId>',
      '<CondicionIVAReceptorId>5</CondicionIVAReceptorId>',
    );
  if (type === 13)
    result = result
      .replace('<ImpNeto>100</ImpNeto>', '<ImpNeto>121</ImpNeto>')
      .replace('<ImpIVA>21</ImpIVA>', '<ImpIVA>0</ImpIVA>')
      .replace(/<Iva>.*?<\/Iva>/, '');
  return result;
}
describe('WSFE credit-note homologation protocol', () => {
  it.each([3, 8, 13] as const)(
    'encodes NC %s with one complete original association in WSDL order',
    async (type) => {
      send.mockResolvedValue(
        answer(
          'FECAESolicitar',
          authorized.replace(
            '<CbteTipo>1</CbteTipo>',
            `<CbteTipo>${type}</CbteTipo>`,
          ),
        ),
      );
      await expect(
        service.authorize('company', creditRequest(type)),
      ).resolves.toMatchObject({ status: 'AUTHORIZED', cae: '12345678901234' });
      const xml = send.mock.calls[0][2];
      expect(xml).toContain(associationXml(type));
      expect(xml.match(/<CbteAsoc>/g)).toHaveLength(1);
      expect(xml.indexOf('<CbtesAsoc>')).toBeGreaterThan(
        xml.indexOf('</CondicionIVAReceptorId>'),
      );
      if (type !== 13)
        expect(xml.indexOf('</CbtesAsoc>')).toBeLessThan(xml.indexOf('<Iva>'));
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it.each([3, 8, 13] as const)(
    'reconciles NC %s only with its original full association',
    async (type) => {
      send.mockResolvedValue(answer('FECompConsultar', creditConsulted(type)));
      await expect(
        service.consult('company', creditRequest(type)),
      ).resolves.toMatchObject({ status: 'AUTHORIZED', cae: '12345678901234' });
      expect(send.mock.calls[0][2]).toContain(
        `<CbteTipo>${type}</CbteTipo><CbteNro>4</CbteNro><PtoVta>1</PtoVta>`,
      );
    },
  );
  it.each([
    ['Tipo', '1', '6'],
    ['PtoVta', '1', '2'],
    ['Nro', '9', '10'],
    ['Cuit', '20123456786', '20123456787'],
    ['CbteFch', '20261003', '20261002'],
  ])(
    'does not reconcile a different original %s',
    async (field, before, after) => {
      const wrong = associationXml().replace(
        `<${field}>${before}</${field}>`,
        `<${field}>${after}</${field}>`,
      );
      send.mockResolvedValue(
        answer(
          'FECompConsultar',
          creditConsulted().replace(associationXml(), wrong),
        ),
      );
      await expect(service.consult('company', creditRequest())).rejects.toThrow(
        'No se pudo verificar',
      );
    },
  );
  it.each([
    '',
    '<CbtesAsoc/>',
    associationXml().replace('<Cuit>20123456786</Cuit>', ''),
    associationXml().replace('<CbteFch>20261003</CbteFch>', ''),
    associationXml() + associationXml(),
    associationXml().replace(
      '</CbtesAsoc>',
      '<CbteAsoc><Tipo>1</Tipo></CbteAsoc></CbtesAsoc>',
    ),
    associationXml().replace('</CbteAsoc>', '<PtoVta>1</PtoVta></CbteAsoc>'),
    associationXml().replace(
      '</CbteAsoc>',
      '<Unexpected>1</Unexpected></CbteAsoc>',
    ),
    associationXml().replace('<Cuit>', '<Cuit xmlns="urn:wrong">'),
    associationXml().replace('<CbtesAsoc>', '<CbtesAsoc>text'),
  ])(
    'rejects incomplete, duplicate or malformed associations %#',
    async (xml) => {
      send.mockResolvedValue(
        answer(
          'FECompConsultar',
          creditConsulted().replace(associationXml(), xml),
        ),
      );
      await expect(
        service.consult('company', creditRequest()),
      ).rejects.toThrow();
    },
  );
  it('still rejects associations on invoices', async () => {
    send.mockResolvedValue(
      answer(
        'FECompConsultar',
        consulted.replace('</ResultGet>', associationXml() + '</ResultGet>'),
      ),
    );
    await expect(service.consult('company', request)).rejects.toThrow();
    await expect(
      service.authorize('company', {
        ...request,
        associated: creditRequest().associated,
      } as unknown as ArcaInvoiceRequest),
    ).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['voucherType', 6],
    ['pointOfSale', 2],
    ['voucherNumber', 0],
    ['issuerCuit', '20123456787'],
    ['date', '20261005'],
  ])(
    'blocks a malformed saved original %s before network activity',
    async (field, value) => {
      const r = creditRequest();
      Object.assign(r.associated, { [field]: value });
      await expect(service.authorize('company', r)).rejects.toThrow();
      await expect(service.consult('company', r)).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
    },
  );
  it.each([3, 8, 13] as const)(
    'validates the correct letter and number series for NC %s',
    async (type) => {
      const r = creditRequest(type);
      const letter = ({ 3: 'A', 8: 'B', 13: 'C' } as const)[type];
      send
        .mockResolvedValueOnce(
          answer(
            'FEParamGetPtosVenta',
            '<ResultGet><PtoVenta><Nro>1</Nro><EmisionTipo>CAE</EmisionTipo><Bloqueado>N</Bloqueado></PtoVenta></ResultGet>',
          ),
        )
        .mockResolvedValueOnce(
          answer(
            'FEParamGetCondicionIvaReceptor',
            `<ResultGet><CondicionIvaReceptor><Id>${r.recipientVatConditionId}</Id><Cmp_Clase>${letter}</Cmp_Clase></CondicionIvaReceptor></ResultGet>`,
          ),
        );
      if (r.iva.length)
        send.mockResolvedValueOnce(
          answer(
            'FEParamGetTiposIva',
            '<ResultGet><IvaTipo><Id>5</Id><FchDesde>20090101</FchDesde></IvaTipo></ResultGet>',
          ),
        );
      await expect(service.validate('company', r)).resolves.toBeUndefined();
      expect(send.mock.calls[1][2]).toContain(`<ClaseCmp>${letter}</ClaseCmp>`);
      send.mockResolvedValueOnce(
        answer(
          'FECompUltimoAutorizado',
          `<PtoVta>1</PtoVta><CbteTipo>${type}</CbteTipo><CbteNro>3</CbteNro>`,
        ),
      );
      expect(await service.lastNumber('company', r.issuerCuit, 1, type)).toBe(
        3,
      );
    },
  );
});
