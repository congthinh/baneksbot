/**
 * Created by Александр on 13.12.2015.
 */
module.exports = function (app, express, mysql) {
    var router = express.Router();

    router.get('/', function(req, res, next) {
        return mysql.query('SELECT * FROM aneks', function (err, rows, fields) {
            return res.json({
                err: err,
                rows: rows,
                fields: fields
            });
        });
        //res.render('index', { title: 'Express' });
    });

    return {
        endPoint: '/aneks',
        router: router
    };
};