"""XIN 项目管理工作台 · 启动脚本"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8088,
        reload=True,
        reload_dirs=["app", "web"],
    )
