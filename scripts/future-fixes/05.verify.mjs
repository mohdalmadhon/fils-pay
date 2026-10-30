import {goProbe} from './go-probe.mjs';
goProbe(`package main
import("context";"fmt";"os";"github.com/jackc/pgx/v5/pgxpool";s "github.com/filspay/settlement/internal/settlement")
func main(){ctx:=context.Background();db,e:=pgxpool.New(ctx,os.Getenv("DATABASE_URL"));if e!=nil{panic(e)};defer db.Close();tx,e:=db.Begin(ctx);if e!=nil{panic(e)};defer tx.Rollback(ctx)
if _,e=tx.Exec(ctx,"UPDATE platform_stats SET total_processed_fils=2147483640 WHERE id=1");e!=nil{panic(e)}
n,e:=s.ReadAndLockPlatformProcessedFils(ctx,tx);if e!=nil{panic(e)};if e=s.RecordPlatformProcessedVolume(ctx,tx,n,100);e!=nil{panic(e)}
var got int64;if e=tx.QueryRow(ctx,"SELECT total_processed_fils FROM platform_stats WHERE id=1").Scan(&got);e!=nil{panic(e)}
if got!=2147483740||s.VolumeTierMdrBonusBps(got)!=15{panic(fmt.Sprint("bad volume ",got))};fmt.Println("05: exact volume above INT4 and tier preserved")}
`);
