import json,sys
from extract import connect,scalar
config=json.load(sys.stdin);c=connect(config)
try:
    tables=['jq_plat_cate_map','jq_sale_industry_m','jq_sale_brand_m','jq_sale_item_m','jq_sale_shop_m']
    result={}
    for t in tables:
        row=scalar(c,'SELECT MAX(insert_time),COUNT(*) FROM '+t)[0]
        result[t]=[str(row[0]),row[1]]
    print(json.dumps(result,sort_keys=True))
finally:c.close()
