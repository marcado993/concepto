import {
  BadRequestException,
  Body,
  Controller,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { Public } from "../shared/auth/public.decorator";
import { Roles } from "../shared/auth/roles.decorator";
import { Role } from "@prisma/client";
import { SubscriptionService } from "./subscription.service";
import { SubscribeDto } from "./dto/subscribe.dto";
import { ConfirmPayphoneDto } from "../locker/dto/confirm-payphone.dto";

@Controller("subscriptions")
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  // Público — ver los tiers y sus precios no expone nada sensible, mismo
  // criterio que /lockers.
  @Public()
  @Get("tiers")
  tiers() {
    return this.subscriptionService.listTiers();
  }

  @Public()
  @Get("payphone/config")
  payphoneConfig() {
    return this.subscriptionService.getPayphoneConfig();
  }

  @Get("mine")
  @Roles(Role.ESTUDIANTE)
  mine(@Req() req: Request & { user: { id: string } }) {
    return this.subscriptionService.getMine(req.user.id);
  }

  @Post()
  @Roles(Role.ESTUDIANTE)
  @Throttle({ short: { limit: 3, ttl: 10_000 } })
  subscribe(@Body() dto: SubscribeDto, @Req() req: Request & { user: { id: string } }) {
    return this.subscriptionService.subscribe({
      userId: req.user.id,
      tierName: dto.tierName,
      method: dto.method,
      ipAddress: req.ip,
    });
  }

  @Post(":subscriptionId/confirm-receipt")
  @Roles(Role.ESTUDIANTE)
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor("receipt"))
  confirmReceipt(
    @Param("subscriptionId") subscriptionId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 8 * 1024 * 1024 }), // 8MB
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
        ],
      })
    )
    file: Express.Multer.File,
    @Req() req: Request & { user: { id: string } }
  ) {
    if (!file?.buffer) throw new BadRequestException("Falta el archivo del comprobante");
    return this.subscriptionService.confirmReceipt(subscriptionId, req.user.id, file.buffer, req.ip);
  }

  // clientTransactionId ES el id de la Subscription — mismo patrón que
  // lockers (ver RentLockerModal.svelte / SubscribeModal.svelte).
  @Post("payphone/confirm")
  @Roles(Role.ESTUDIANTE)
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  confirmPayphone(@Body() dto: ConfirmPayphoneDto, @Req() req: Request & { user: { id: string } }) {
    return this.subscriptionService.confirmPayphonePayment(dto.clientTransactionId, dto.id, req.user.id, req.ip);
  }
}
