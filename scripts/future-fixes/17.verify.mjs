import {goProbe} from './go-probe.mjs';
goProbe(`package main
import("context";"fmt";"os";"time";"github.com/google/uuid";"github.com/jackc/pgx/v5/pgxpool";s "github.com/filspay/settlement/internal/settlement")
func main(){ctx:=context.Background();db,e:=pgxpool.New(ctx,os.Getenv("DATABASE_URL"));if e!=nil{panic(e)};defer db.Close();tx,e:=db.Begin(ctx);if e!=nil{panic(e)};defer tx.Rollback(ctx)
m:=uuid.New();_,e=tx.Exec(ctx,"INSERT INTO merchants(id,display_name) VALUES($1,'audit17')",m);if e!=nil{panic(e)}
_,e=tx.Exec(ctx,"INSERT INTO fee_schedules(merchant_id,mdr_bps,effective_from,created_at) VALUES($1,225,'2026-01-01','2026-02-01'),($1,245,'2026-01-01','2026-01-01')",m);if e!=nil{panic(e)}
rows,e:=s.LoadFeeSchedules(ctx,tx,m);if e!=nil{panic(e)};if s.EffectiveMdrBpsAt(rows,time.Date(2026,3,1,0,0,0,0,time.UTC),250)!=225{panic("Go did not choose newest correction")};fmt.Println("17: Go selects latest-entered same-effective-date correction, matching API")}
`);
