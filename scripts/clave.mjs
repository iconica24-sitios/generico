/* =========================================================================
   Genera la línea de un usuario para CMS_USUARIOS (panel /admin)
   -------------------------------------------------------------------------
   Uso:   node scripts/clave.mjs <usuario> <contraseña>
   Da:    usuario:sal:hash

   La contraseña no se guarda: sólo su huella (scrypt) con una sal al azar.
   Para varios usuarios, separa las líneas con comas en CMS_USUARIOS.
   Sin contraseña, genera una segura y la muestra una sola vez.
   ========================================================================= */
import { scryptSync, randomBytes } from 'node:crypto';

const [usuario, claveDada] = process.argv.slice(2);
if (!usuario || !/^[a-z0-9._-]+$/i.test(usuario)) {
  console.error('Uso: node scripts/clave.mjs <usuario> [contraseña]\nEl usuario sólo puede llevar letras, números, punto, guion y guion bajo.');
  process.exit(1);
}
const clave = claveDada || randomBytes(12).toString('base64url');
const sal = randomBytes(16).toString('hex');
const hash = scryptSync(clave, sal, 32).toString('hex');

if (!claveDada) console.log(`Contraseña generada (guárdala, no se vuelve a mostrar): ${clave}\n`);
console.log(`${usuario.toLowerCase()}:${sal}:${hash}`);
