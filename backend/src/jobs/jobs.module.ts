import { Module } from "@nestjs/common";
import { JobController } from "./job.controller";
import { JobService } from "./job.service";
import { JobIngestService } from "./job-ingest.service";
import { RemoteOkSource } from "./sources/remoteok.source";
import { ArbeitnowSource } from "./sources/arbeitnow.source";
import { RemotiveSource } from "./sources/remotive.source";
import { JobSpySource } from "./sources/jobspy.source";

// Bolsa de empleo — pasantias y vacantes de Sistemas/Software.
//
// Reemplaza a Emprendimientos como modulo VISIBLE de la app (VentureModule
// sigue registrado y sus endpoints siguen vivos; lo que se quito fue la
// categoria del menu del front — decision reversible a proposito).
//
// `exports: [JobIngestService]` es para que el panel de administracion
// pueda disparar una ingesta manual sin esperar al cron de cada 3 horas.
@Module({
  controllers: [JobController],
  providers: [JobService, JobIngestService, RemoteOkSource, ArbeitnowSource, RemotiveSource, JobSpySource],
  exports: [JobIngestService],
})
export class JobsModule {}
