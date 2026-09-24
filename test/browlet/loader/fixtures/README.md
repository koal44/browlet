# Local HTTPS fixture

The certificate and private key are public test data for loopback servers.
Tests explicitly trust this certificate when exercising authenticated HTTPS;
the untrusted-certificate test uses the transport's normal trust store.

Regenerate from the repository root:

```powershell
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 36500 -config test/browlet/loader/fixtures/openssl.cnf -keyout test/browlet/loader/fixtures/localhost-key.pem -out test/browlet/loader/fixtures/localhost-cert.pem
```
