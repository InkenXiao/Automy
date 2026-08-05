"""XIN · CoWork 项目管理智能体工作平台 · 启动脚本"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8091,
        reload=True,
        reload_dirs=["app", "web"],
    )
