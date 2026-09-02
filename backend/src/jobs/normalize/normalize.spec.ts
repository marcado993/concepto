import {
  stripHtml,
  truncate,
  parseDate,
  canonicalCompany,
  canonicalTitle,
  jobFingerprint,
  MAX_DESCRIPTION,
} from "./normalize";

describe("stripHtml", () => {
  it("Dado HTML con etiquetas, Cuando se limpia, Entonces queda solo el texto", () => {
    expect(stripHtml("<p>Buscamos <strong>dev</strong> Node</p>")).toBe("Buscamos dev Node");
  });

  // Seguridad, no cosmetica: Remotive devuelve HTML escrito por la empresa
  // que publica. Si se guardara crudo, cualquier vista futura que lo
  // renderice sin escapar tendria un XSS almacenado. Se corta en la
  // ingesta para que ningun render pueda reintroducir el agujero.
  it("Dado un <script> embebido, Cuando se limpia, Entonces se borra CON su contenido", () => {
    const out = stripHtml('<p>Hola</p><script>alert("xss")</script>');

    expect(out).not.toContain("alert");
    expect(out).not.toContain("<script");
    expect(out).toContain("Hola");
  });

  it("Dado un <style>, Cuando se limpia, Entonces tampoco deja el CSS como si fuera texto de la oferta", () => {
    const out = stripHtml("<style>.a{color:red}</style><p>Vacante</p>");

    expect(out).not.toContain("color:red");
    expect(out).toContain("Vacante");
  });

  it("Dado un onerror en un img, Cuando se limpia, Entonces no queda ningun atributo ejecutable", () => {
    const out = stripHtml('<img src=x onerror="alert(1)">Backend');

    expect(out).not.toContain("onerror");
    expect(out).toContain("Backend");
  });

  it("Dadas entidades HTML, Cuando se limpia, Entonces se decodifican", () => {
    expect(stripHtml("Java&nbsp;&amp;&nbsp;SQL")).toBe("Java & SQL");
  });

  it("Dada una lista <li>, Cuando se limpia, Entonces conserva la estructura como vinetas de texto", () => {
    const out = stripHtml("<ul><li>Node</li><li>SQL</li></ul>");

    expect(out).toContain("- Node");
    expect(out).toContain("- SQL");
  });

  it("Dado <br>, Cuando se limpia, Entonces se convierte en salto de linea", () => {
    expect(stripHtml("Node<br>SQL")).toBe("Node\nSQL");
  });

  it("Dado texto sin HTML, Cuando se limpia, Entonces lo devuelve intacto", () => {
    expect(stripHtml("Desarrollador Backend Java")).toBe("Desarrollador Backend Java");
  });

  it("Dada una cadena vacia, Cuando se limpia, Entonces devuelve vacio sin romper", () => {
    expect(stripHtml("")).toBe("");
  });
});

describe("truncate", () => {
  it("Dado un texto mas corto que el maximo, Cuando se recorta, Entonces no lo toca", () => {
    expect(truncate("corto", 100)).toBe("corto");
  });

  it("Dado un texto largo, Cuando se recorta, Entonces no parte una palabra por la mitad", () => {
    const out = truncate("palabra ".repeat(50), 30);

    expect(out.length).toBeLessThanOrEqual(31); // +1 por el caracter de elipsis
    expect(out).toMatch(/…$/);
    expect(out).not.toMatch(/pala…$/);
  });

  // Sin este caso, una descripcion sin espacios (un JSON pegado, base64)
  // se recortaba a casi nada porque no habia donde cortar limpio.
  it("Dado un texto sin espacios, Cuando se recorta, Entonces igual respeta el limite", () => {
    const out = truncate("a".repeat(200), 50);

    expect(out.length).toBeLessThanOrEqual(51);
  });

  it("Dado el maximo por defecto, Cuando se recorta una descripcion enorme de LinkedIn, Entonces cabe en el limite", () => {
    expect(truncate("x ".repeat(20_000)).length).toBeLessThanOrEqual(MAX_DESCRIPTION + 1);
  });
});

describe("parseDate", () => {
  it("Dada una fecha ISO, Cuando se parsea, Entonces devuelve el Date correcto", () => {
    expect(parseDate("2026-08-15T10:00:00Z")?.toISOString()).toBe("2026-08-15T10:00:00.000Z");
  });

  // Confundir la unidad ponia toda la ingesta en 1970 y el motor archivaba
  // absolutamente todo por "antiguo".
  it("Dado un epoch en SEGUNDOS, Cuando se parsea, Entonces lo interpreta como segundos y no como ms", () => {
    expect(parseDate(1_756_000_000)?.getUTCFullYear()).toBe(2025);
  });

  it("Dado un epoch en MILISEGUNDOS, Cuando se parsea, Entonces tambien da el anio correcto", () => {
    expect(parseDate(1_756_000_000_000)?.getUTCFullYear()).toBe(2025);
  });

  it("Dado un Date ya construido, Cuando se parsea, Entonces lo devuelve tal cual", () => {
    const d = new Date("2026-01-01T00:00:00Z");

    expect(parseDate(d)).toBe(d);
  });

  // Una fecha inventada distorsiona el ranking entero; la ausencia de fecha
  // solo cuesta -3 en el motor. Ante la duda, null.
  it.each([[null], [undefined], [""], ["no soy una fecha"], [{}], [NaN], [new Date("nope")]])(
    "Dado el valor invalido %p, Cuando se parsea, Entonces devuelve null en vez de inventar una fecha",
    (value) => {
      expect(parseDate(value)).toBeNull();
    }
  );
});

describe("canonicalCompany", () => {
  // "Acme S.A." en Multitrabajos y "Acme" en LinkedIn son la MISMA empresa.
  it.each([
    ["Acme S.A.", "Acme"],
    ["Acme Cia. Ltda.", "ACME"],
    ["Banco Pichincha C.A.", "Banco Pichincha"],
    ["Globant Inc", "Globant"],
  ])("Dado '%s' y '%s', Cuando se canonizan, Entonces coinciden", (a, b) => {
    expect(canonicalCompany(a)).toBe(canonicalCompany(b));
  });

  it("Dadas empresas distintas, Cuando se canonizan, Entonces NO coinciden", () => {
    expect(canonicalCompany("Acme S.A.")).not.toBe(canonicalCompany("Beta S.A."));
  });

  it("Dado un nombre con tildes, Cuando se canoniza, Entonces las quita", () => {
    expect(canonicalCompany("Telefónica")).toBe("telefonica");
  });
});

describe("canonicalTitle", () => {
  // Las fuentes cuelgan entre parentesis datos que NO cambian el puesto.
  it.each([
    ["Backend Developer (Remote)", "Backend Developer"],
    ["Backend Developer [Quito]", "Backend Developer"],
    ["Backend Developer - Ecuador", "Backend Developer Ecuador"],
  ])("Dado '%s', Cuando se canoniza, Entonces se acerca a '%s'", (raw) => {
    expect(canonicalTitle(raw)).not.toContain("(");
    expect(canonicalTitle(raw)).not.toContain("[");
  });

  it("Dado el mismo puesto con y sin '(Remote)', Cuando se canonizan, Entonces coinciden", () => {
    expect(canonicalTitle("Backend Developer (Remote)")).toBe(canonicalTitle("Backend Developer"));
  });

  it("Dado un titulo con stack, Cuando se canoniza, Entonces conserva '.' y '#' que son parte del nombre", () => {
    expect(canonicalTitle("Dev C# / .NET")).toContain("c#");
    expect(canonicalTitle("Dev C# / .NET")).toContain(".net");
  });
});

describe("jobFingerprint", () => {
  it("Dada la misma vacante replicada en dos bolsas, Cuando se calcula la huella, Entonces es la misma", () => {
    const a = jobFingerprint({ company: "Acme S.A.", title: "Backend Developer (Remote)" });
    const b = jobFingerprint({ company: "ACME", title: "Backend Developer" });

    expect(a).toBe(b);
  });

  it("Dado el mismo puesto en empresas distintas, Cuando se calcula la huella, Entonces difieren", () => {
    const a = jobFingerprint({ company: "Acme", title: "Backend Developer" });
    const b = jobFingerprint({ company: "Beta", title: "Backend Developer" });

    expect(a).not.toBe(b);
  });

  it("Dados puestos distintos en la misma empresa, Cuando se calcula la huella, Entonces difieren", () => {
    const a = jobFingerprint({ company: "Acme", title: "Backend Developer" });
    const b = jobFingerprint({ company: "Acme", title: "Frontend Developer" });

    expect(a).not.toBe(b);
  });
});
