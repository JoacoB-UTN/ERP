# Primera prueba de facturación con ARCA

Guía operativa de facturas y notas de crédito totales de homologación.
Estado: implementación verificada localmente; prueba autenticada con ARCA pendiente.
Fuentes oficiales consultadas el 4 de octubre de 2026. Las pantallas del portal
pueden cambiar; seguir sus nombres actuales y el manual enlazado.

## 1. Definir la identidad de prueba

Antes de generar archivos, identificar quién tendrá acceso a WSASS y qué CUIT
representará el comprobante. Registrar también la condición frente al IVA que
corresponda al escenario de homologación, sin asumirla por defecto.

ARCA indica que WSASS se adhiere desde una cuenta de persona física. Su manual
separa el CUIT del certificado (usuario conectado) del CUIT representado en la
autorización al servicio. El ERP admite ambos casos: si coinciden, conserva el comportamiento directo;
si difieren, el administrador debe declarar explícitamente esa representación
en `representation.json` dentro de la carpeta de credenciales de la empresa
(ver [configuración técnica](fiscal.md#server-only-credentials-and-wsaa-authentication)).
La autorización para representar al emisor se concede además en WSASS para
`wsfe`; el archivo local por sí solo no la otorga. No cambiar el CUIT real de la
empresa por el de la persona titular del certificado. Usar un certificado/alias
dedicado por empresa para evitar conflictos con tickets WSAA de otras compañías.

Fuentes: [certificados de homologación](https://www.arca.gob.ar/ws/documentacion/certificados.asp),
[identidad del certificado](https://www.arca.gob.ar/ws/WSASS/html/crearcertificado.html) y
[CUIT representado](https://www.arca.gob.ar/ws/WSASS/html/crearautorizacion.html).

## 2. Obtener el certificado de pruebas

El titular ingresa personalmente al portal de ARCA con su clave fiscal y habilita
**WSASS / Autoservicio de Acceso a APIs de Homologación**, si aún no lo tiene.
La clave fiscal se utiliza en ese portal; no se carga en el ERP ni en el chat.

Con el CUIT definido, preparar en el servidor una clave privada RSA de al menos
2048 bits y una solicitud CSR con el atributo `serialNumber=CUIT <11 dígitos>`.
Guardar la clave fuera del repositorio y conservarla: el certificado descargado
necesitará esa misma clave. No ejecutar una generación que sobrescriba archivos
existentes. Esta guía no genera credenciales ni elige una identidad por el usuario.
El procedimiento técnico oficial está en
[generación del CSR](https://www.arca.gob.ar/ws/WSASS/html/generarcsr.html).

En WSASS, usar **Nuevo Certificado**, elegir un alias nuevo para este ERP de
pruebas y presentar el CSR. Guardar el certificado PEM devuelto como
`certificate.pem`. Después usar **Crear Autorización a Servicio**, seleccionar
ese alias, el CUIT representado acordado y el servicio `wsfe`.
Consultar [alta del certificado](https://www.arca.gob.ar/ws/WSASS/html/crearcertificado.html)
y [autorización de acceso](https://www.arca.gob.ar/ws/WSASS/html/crearautorizacion.html).
No usar el trámite de certificados de producción para este ensayo.

## 3. Instalar en el servidor de pruebas

El administrador instala `certificate.pem` y la clave correspondiente como
`private-key.pem` en una carpeta privada identificada por el UUID de la empresa
del ERP. Configura `ERP_ARCA_CREDENTIALS_DIR` en el proceso del servidor.
Los requisitos completos de rutas, permisos y ACL de Windows están en
[fiscal.md](fiscal.md#server-only-credentials-and-wsaa-authentication).
No adjuntar estos archivos a una pull request ni copiarlos en registros.

En Gestión, abrir **Configuración fiscal** de la empresa elegida, revisar la
identidad y completar su condición de IVA y punto de venta de homologación.
El punto de venta debe estar habilitado para el servicio y reservado para este
ERP. No inventar un número ni asumir que un punto de venta de producción está
habilitado en pruebas. El envío del ERP verifica el catálogo autenticado de
puntos de venta de homologación; si el punto no aparece o no es apto, resolverlo
antes de enviar. Este documento no da de alta puntos de venta en producción.

## 4. Comprobar y emitir una sola prueba

1. Pulsar **Comprobar disponibilidad de ARCA**. Un resultado correcto sólo
   verifica disponibilidad del servicio público.
2. Ejecutar la comprobación de autenticación. Debe indicar acceso de pruebas
   correcto y vencimiento del ticket. Si falla, revisar certificado, clave,
   CUIT y autorización a `wsfe`; no insistir con envíos de comprobantes.
3. En la instalación aislada, preparar una venta confirmada de productos en ARS
   a un receptor identificado por CUIT, con datos fiscales explícitos. Confirmar
   la venta produce los movimientos comerciales normales del ERP; por eso esta
   prueba no debe hacerse sobre ventas operativas reales.
4. Preparar y guardar su borrador fiscal. Revisar tipo A/B/C, IVA e importes.
   Los datos del emisor y receptor deben estar correctos antes de guardar el
   borrador: el envío exige que coincidan con su instantánea guardada.
5. Confirmar homologación y uso exclusivo del punto de venta. Enviar una vez.
   Verificar estado autorizado, número, CAE de prueba y vencimiento. Un CAE de
   homologación no habilita a entregar una factura fiscal válida.

Si aparece **SENDING** o **UNKNOWN**, consultar el resultado del mismo intento.
No generar otro borrador para reintentar, cambiar de punto de venta ni reutilizar
el número. La consulta que no encuentra el comprobante mantiene el bloqueo y
requiere investigación; no habilita automáticamente un nuevo envío. Un rechazo
concluyente permite una corrección y un nuevo intento explícito.

## 5. Probar una nota de crédito total

Desde el detalle de una factura autorizada en homologación, abrir **Nota de
crédito total**. Revisar la factura asociada y el importe completo, ingresar el
motivo y guardar. Esta preparación no envía un comprobante. La nota conserva
los importes y datos originales; no toma precios nuevos ni permite una nota
parcial en esta etapa.

Con la nota guardada y sin cambios pendientes, confirmar explícitamente el uso
de homologación y el punto de venta exclusivo, y autorizar una vez. La nota usa
su propia serie y número: puede tener el mismo número que una factura porque
son tipos de comprobante diferentes. Verificar su estado y CAE de prueba por
separado del resultado de la factura original.

Si la nota queda pendiente o con resultado desconocido, usar **Consultar
resultado de la nota**. No reenviarla ni crear otra para reemplazarla. Un resultado
incierto bloquea nuevos envíos de esa serie hasta resolverlo; la factura original
conserva su propio estado autorizado. La edición del motivo queda bloqueada con
un intento pendiente o autorizado.

En **Comprobantes de prueba**, el seguimiento de la nota permite regresar a su
detalle. La impresión muestra el número y CAE de la nota, la referencia a la
factura original, el motivo y la leyenda **SIN VALIDEZ FISCAL — SOLO PRUEBAS**.
Seleccionar factura o nota imprime únicamente ese documento. También puede
usarse la opción del navegador para guardar esa impresión como PDF de prueba.

Una NC autorizada en este entorno no devuelve dinero, no ingresa mercadería ni
reduce la deuda comercial. No registrar una devolución real suponiendo que este
ensayo la aplica automáticamente.

## 6. Registrar el resultado sin secretos

Anotar la versión del ERP, fecha, empresa de prueba, punto de venta, tipo y número,
estado final y resultado de la consulta. Conservar la evidencia en el entorno
privado de prueba; no publicar datos personales, tokens ni archivos de claves.
Antes de considerar terminada la homologación, comprobar también que recargar
la pantalla conserva el resultado y que el envío fiscal no agrega movimientos
comerciales nuevos a los de la venta ya confirmada.

La compatibilidad real de la firma y el circuito sólo queda validada tras esta
prueba. Un reinicio del servidor pierde el ticket guardado en memoria y puede
requerir esperar su vencimiento antes de volver a autenticarse. La activación de
producción, impresión fiscal/QR, notas parciales y devoluciones comerciales siguen
siendo etapas separadas. Registrar la evidencia de factura y NC por separado.
